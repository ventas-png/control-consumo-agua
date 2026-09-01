// domain/portal/mutations.ts — Escrituras del portal del RESIDENTE. Pago en línea:
// cuotas de condominio (F1) y recibos de agua (F2).
//
// El residente (rol cliente) invoca estos edges con SU propio JWT: create-charge /
// confirm-charge lo autorizan por PROPIEDAD del ítem (su unidad/cuota/recibo). La
// capa de datos aísla el I/O a Supabase de los componentes (boundary T7).
import { supabase } from '../../lib/supabase'
import { extractFunctionError } from '../functionError'

export interface IniciarPagoResult {
  /** Estado normalizado del provider: aprobado | requiere_accion | pendiente | rechazado | error. */
  estado: string | null
  /** Hosted checkout: URL a la que redirigir al residente para pagar (si aplica). */
  redirectUrl: string | null
  /** Id de la solicitud de cobro, para confirmar tras el retorno. */
  paymentRequestId: string | null
  error: string | null
}
/** @deprecated Usa IniciarPagoResult (genérico cuota/recibo). */
export type IniciarPagoCuotaResult = IniciarPagoResult

/** Normaliza la respuesta cruda del edge `create-charge` al resultado del portal. */
function parseIniciarPago(data: unknown, error: unknown): Promise<IniciarPagoResult> | IniciarPagoResult {
  if (error) return extractFunctionError(error).then(msg => ({ estado: null, redirectUrl: null, paymentRequestId: null, error: msg }))
  const d = data as { estado?: string; redirectUrl?: string | null; payment_request_id?: string | null; error?: string | null } | null
  if (d?.error) return { estado: d.estado ?? 'error', redirectUrl: null, paymentRequestId: null, error: d.error }
  return {
    estado: d?.estado ?? null,
    redirectUrl: d?.redirectUrl ?? null,
    paymentRequestId: d?.payment_request_id ?? null,
    error: null,
  }
}

/**
 * Inicia el cobro de una cuota. `monto` opcional = saldo completo; un monto menor
 * es un ABONO parcial (el servidor lo acota al saldo). Devuelve la URL del checkout
 * (payfacs con hosted checkout) o `estado='aprobado'` directo (sandbox).
 */
export async function iniciarPagoCuota(cuotaId: string, monto?: number): Promise<IniciarPagoResult> {
  const base = window.location.origin
  const { data, error } = await supabase.functions.invoke('create-charge', {
    body: {
      cuota_id: cuotaId,
      ...(monto && monto > 0 ? { monto } : {}),
      url_retorno: `${base}/portal?pago=ok`,
      url_cancelacion: `${base}/portal?pago=cancelado`,
    },
  })
  return parseIniciarPago(data, error)
}

/**
 * Inicia el cobro de un RECIBO de agua (registro). `monto` opcional = saldo; un
 * monto menor es un ABONO parcial (el servidor lo acota al saldo). Mismo flujo que
 * `iniciarPagoCuota`: URL de checkout (hosted) o `estado='aprobado'` directo (sandbox).
 */
export async function iniciarPagoRegistro(registroId: string, monto?: number): Promise<IniciarPagoResult> {
  const base = window.location.origin
  const { data, error } = await supabase.functions.invoke('create-charge', {
    body: {
      registro_id: registroId,
      ...(monto && monto > 0 ? { monto } : {}),
      url_retorno: `${base}/portal?pago=ok`,
      url_cancelacion: `${base}/portal?pago=cancelado`,
    },
  })
  return parseIniciarPago(data, error)
}

export interface ConfirmarPagoResult {
  estado: string | null
  /** ¿El ítem (cuota/recibo) quedó liquidado (saldo 0)? */
  liquidado: boolean
  /** Saldo que queda tras el pago (para abonos parciales). */
  saldoRestante: number | null
  error: string | null
}

/**
 * Confirma+concilia server-side un cobro en línea (cuota o recibo) tras el retorno
 * del checkout o la aprobación inmediata (sandbox). Idempotente. Genérico: el edge
 * sabe si el payment_request es de cuota o de registro.
 */
export async function confirmarPago(paymentRequestId: string): Promise<ConfirmarPagoResult> {
  const { data, error } = await supabase.functions.invoke('confirm-charge', {
    body: { payment_request_id: paymentRequestId },
  })
  if (error) return { estado: null, liquidado: false, saldoRestante: null, error: await extractFunctionError(error) }
  const d = data as { estado?: string; liquidado?: boolean; cuota_liquidada?: boolean; saldo_restante?: number | null; error?: string | null } | null
  if (d?.error) return { estado: d.estado ?? 'error', liquidado: false, saldoRestante: null, error: d.error }
  return {
    estado: d?.estado ?? null,
    liquidado: d?.liquidado === true || d?.cuota_liquidada === true,
    saldoRestante: typeof d?.saldo_restante === 'number' ? d.saldo_restante : null,
    error: null,
  }
}

export interface ConfirmarPagoCuotaResult {
  estado: string | null
  /** ¿La cuota quedó liquidada (saldo 0)? */
  cuotaLiquidada: boolean
  saldoRestante: number | null
  error: string | null
}

/** F1: confirma un pago de cuota. Alias de `confirmarPago` con el nombre del dominio. */
export async function confirmarPagoCuota(paymentRequestId: string): Promise<ConfirmarPagoCuotaResult> {
  const r = await confirmarPago(paymentRequestId)
  return { estado: r.estado, cuotaLiquidada: r.liquidado, saldoRestante: r.saldoRestante, error: r.error }
}
