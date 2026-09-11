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

/** Lo que devuelve `stripe_webhook_evento_reclamar`. */
export interface Reclamo {
  reclamado: boolean
  ya_completado: boolean
  estado_previo?: string | null
  intentos?: number
}

/** Lo que devuelve `conciliar_pago_externo`. */
export interface Conciliacion {
  ok?: boolean
  pago_id?: string | null
  liquidado?: boolean
  saldo_restante?: number
  ya_conciliado?: boolean
}

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

  const r = res ?? {}
  return {
    accion: 'responder',
    status: 200,
    body: {
      received: true,
      conciliado: true,
      ...(r.ya_conciliado ? { already_processed: true } : {}),
      pago_id: r.pago_id ?? null,
      liquidado: r.liquidado === true,
      saldo_restante: r.saldo_restante ?? 0,
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
