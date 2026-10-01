// Lógica PURA de stripe-webhook-handler: qué responderle a Stripe. Sin Deno,
// sin supabase-js y sin el SDK de Stripe → corre directo en vitest.
//
// Antes este módulo exportaba `buildPagoRow`, que armaba a mano la fila de
// `pagos`. Ya no existe: el pago lo inserta `conciliar_pago_externo` dentro de
// la transacción que además ACREDITA el recibo. Construirla aquí era justo el
// problema — dejaba el cobro registrado y el recibo con el saldo íntegro.
//
// Lo que sí es decisión del edge, y por tanto lo que vive aquí, es el CÓDIGO
// HTTP. Y no es cosmético: Stripe reintenta ante cualquier respuesta que no sea
// 2xx, así que devolver 200 equivale a decir «no lo traigas más». Esa frase sólo
// es verdad cuando el evento se procesó ENTERO.

import { leerConciliacion, type RespuestaRegistro } from '../_shared/payments/conciliacion.ts'

/** Lo que devuelve `stripe_webhook_evento_reclamar`. */
export interface Reclamo {
  reclamado: boolean
  ya_completado: boolean
  estado_previo?: string | null
  intentos?: number
}

/** Lo que devuelve `pasarela_registrar_estado` ante un «aprobado» (con su estado persistido). */
export type Conciliacion = RespuestaRegistro

export type Decision =
  | { accion: 'procesar' }
  | { accion: 'responder'; status: number; body: Record<string, unknown> }

/**
 * Tras intentar reclamar el evento. Tres salidas, y la diferencia entre las dos
 * últimas es la que este PR viene a arreglar:
 *
 *   · reclamado          → es nuestro, hay que procesar.
 *   · ya completado      → 200. Otro lo terminó de punta a punta; reaplicarlo
 *                          duplicaría el abono, y pedirle a Stripe que lo
 *                          reintente sería pedirle que insista para siempre.
 *   · NO completado      → 409. Otro lo tiene en vuelo. Es un duplicado, sí,
 *                          pero NO hay constancia de que el cobro se haya
 *                          acreditado: responder 200 aquí es la forma de perder
 *                          un pago en silencio. Que Stripe lo vuelva a traer.
 */
export function decidirTrasReclamo(r: Reclamo): Decision {
  if (r.reclamado) return { accion: 'procesar' }

  if (r.ya_completado) {
    return {
      accion: 'responder',
      status: 200,
      body: { received: true, already_processed: true },
    }
  }

  return {
    accion: 'responder',
    status: 409,
    body: {
      received: false,
      retryable: true,
      error: 'evento en proceso por otra entrega; reintentar',
      estado_previo: r.estado_previo ?? null,
    },
  }
}

/**
 * Tras conciliar. Un fallo aquí es SIEMPRE reintentable: el dinero ya salió de
 * la tarjeta y la transacción revirtió entera, así que no hay nada escrito a
 * medias — sólo un cobro sin acreditar que el siguiente intento cuadra.
 */
export function decidirTrasConciliar(
  res: Conciliacion | null | undefined,
  error: { message: string } | null | undefined,
): Decision {
  if (error) {
    return {
      accion: 'responder',
      status: 500,
      body: {
        received: false,
        retryable: true,
        error: `cobro verificado pero NO conciliado: ${error.message}`,
      },
    }
  }

  // Se decide por el ESTADO PERSISTIDO que devuelve la RPC, no por `accion`
  // (un duplicado de un cobro retenido no está conciliado). Lo no acreditado
  // también es 200: el evento quedó registrado y reintentarlo no cambiaría
  // nada.
  const l = leerConciliacion(res)
  if (l.tipo !== 'conciliado') {
    return {
      accion: 'responder',
      status: 200,
      body: {
        received: true,
        conciliado: false,
        ...(l.tipo === 'en_revision' ? { en_revision: true } : {}),
        ...(l.tipo === 'reembolsado' ? { reembolsado: true } : {}),
        estado_solicitud: l.tipo === 'en_revision' ? l.estadoSolicitud
          : l.tipo === 'reembolsado' ? 'refunded' : l.estadoSolicitud,
        incidencia_id: l.incidenciaId,
      },
    }
  }
  return {
    accion: 'responder',
    status: 200,
    body: {
      received: true,
      conciliado: true,
      ...(l.yaConciliado ? { already_processed: true } : {}),
      pago_id: l.pagoId,
      liquidado: l.liquidado,
      saldo_restante: l.saldoRestante,
    },
  }
}

/**
 * La empresa del webhook verificado tiene que ser la de la solicitud. Sin esto,
 * el secreto de la empresa A serviría para conciliar un cobro de la empresa B.
 * No es reintentable: reenviarlo daría el mismo resultado.
 */
export function decidirCruceDeEmpresa(
  companyIdVerificado: string,
  companyIdSolicitud: string,
): Decision {
  if (companyIdVerificado === companyIdSolicitud) return { accion: 'procesar' }
  return {
    accion: 'responder',
    status: 400,
    body: { received: false, retryable: false, error: 'la solicitud de cobro es de otra empresa' },
  }
}

/**
 * Tras sellar el resultado del evento. Si el sello no se pudo escribir, la
 * respuesta pasa a ser reintentable AUNQUE el procesamiento haya salido bien.
 *
 * Parece contraintuitivo devolver 500 después de acreditar correctamente, pero
 * las dos alternativas son peores. Un 200 con el evento sin sellar deja a Stripe
 * sin traerlo más y a la tabla sin constancia de que terminó: nadie sabría
 * distinguirlo de un cobro perdido. Reintentar, en cambio, es barato — la
 * conciliación responde `ya_conciliado` y el sello se vuelve a intentar.
 */
export function decidirTrasSellar(
  sellado: boolean,
  decision: Decision,
): Decision {
  if (sellado) return decision
  return {
    accion: 'responder',
    status: 500,
    body: {
      received: false,
      retryable: true,
      error: 'el evento se procesó pero no se pudo sellar su resultado',
    },
  }
}

/**
 * Qué estado del proveedor representa un evento de Stripe, y sobre qué
 * PaymentIntent (20261011000000). `null` = el evento no cambia la solicitud:
 * se cierra como procesado sin tocar nada.
 *
 *   · payment_intent.succeeded       → aprobado
 *   · payment_intent.payment_failed  → rechazado (no retrocede un succeeded)
 *   · charge.refunded, TOTAL         → reembolsado
 *   · charge.refunded, PARCIAL       → null: no cambia la solicitud. Lo
 *                                      registra `reembolsoParcialDeEvento`
 *                                      (20261012000000); un reembolso parcial
 *                                      no rechaza el cobro.
 */
export function estadoDeEventoStripe(
  tipo: string,
  obj: { id?: string; payment_intent?: string | null; refunded?: boolean | null },
): { estado: 'aprobado' | 'rechazado' | 'reembolsado'; intentId: string | null } | null {
  if (tipo === 'payment_intent.succeeded') return { estado: 'aprobado', intentId: obj.id ?? null }
  if (tipo === 'payment_intent.payment_failed') return { estado: 'rechazado', intentId: obj.id ?? null }
  // E8 (20261019000000): un PaymentIntent CANCELADO es un estado final de
  // no-cobro informado por el proveedor: la solicitud pasa a failed.
  if (tipo === 'payment_intent.canceled') return { estado: 'rechazado', intentId: obj.id ?? null }
  if (tipo === 'charge.refunded') {
    if (obj.refunded !== true) return null
    return { estado: 'reembolsado', intentId: obj.payment_intent ?? null }
  }
  return null
}

/** Monedas sin decimales en Stripe (el importe viene en unidades enteras). */
const MONEDAS_SIN_DECIMALES = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
])

/** Importe de Stripe (unidad mínima) → importe con decimales. */
export function importeDesdeStripe(minimo: number, moneda: string): number {
  if (MONEDAS_SIN_DECIMALES.has(moneda.toLowerCase())) return minimo
  return Math.round(minimo) / 100
}

export interface ReembolsoParcial {
  intentId: string
  /** Acumulado reembolsado del cargo, ya en la moneda (no en centavos). */
  acumulado: number
  moneda: string
  /** Referencia del pago en el proveedor (id del cargo). */
  referenciaPago: string | null
  /** Último reembolso informado, si el evento lo trae. */
  reembolsoRef: string | null
}

/**
 * Datos de un reembolso PARCIAL (`charge.refunded` con `refunded: false`)
 * para `pasarela_registrar_reembolso_parcial` (20261012000000). Stripe
 * informa el ACUMULADO reembolsado del cargo (`amount_refunded`): la RPC
 * cuenta sólo el aumento respecto del mayor ya visto, así que un evento
 * repetido o que llega fuera de orden no suma dos veces.
 *
 * `null` si no es un reembolso parcial o le faltan datos para registrarlo.
 */
export function reembolsoParcialDeEvento(
  tipo: string,
  obj: {
    id?: string
    payment_intent?: string | null
    refunded?: boolean | null
    amount_refunded?: number | null
    currency?: string | null
    refunds?: { data?: Array<{ id?: string; created?: number }> } | null
  },
): ReembolsoParcial | null {
  if (tipo !== 'charge.refunded' || obj.refunded === true) return null
  if (!obj.payment_intent || !obj.currency) return null
  const minimo = Number(obj.amount_refunded ?? 0)
  if (!Number.isFinite(minimo) || minimo <= 0) return null
  const ultimos = [...(obj.refunds?.data ?? [])].sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
  return {
    intentId: obj.payment_intent,
    acumulado: importeDesdeStripe(minimo, obj.currency),
    moneda: obj.currency.toUpperCase(),
    referenciaPago: obj.id ?? null,
    reembolsoRef: ultimos[0]?.id ?? null,
  }
}
