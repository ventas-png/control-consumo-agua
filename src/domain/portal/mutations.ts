// domain/portal/mutations.ts — Escrituras del portal del RESIDENTE. F1 pago en línea.
//
// El residente (rol cliente) invoca estos edges con SU propio JWT: create-charge /
// confirm-charge lo autorizan por PROPIEDAD del ítem (su unidad/cuota). La capa de
// datos aísla el I/O a Supabase de los componentes (boundary T7).
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'

/** Extrae el mensaje real del edge (el SDK oculta el body `{ error }` en context). */
async function extractFunctionError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as { error?: string } | null
      if (body?.error) return body.error
    } catch { /* body no-JSON: cae al mensaje genérico */ }
  }
  const msg = (error as { message?: unknown } | null)?.message
  return typeof msg === 'string' ? msg : String(error)
}

export interface IniciarPagoCuotaResult {
  /** Estado normalizado del provider: aprobado | requiere_accion | pendiente | rechazado | error. */
  estado: string | null
  /** Hosted checkout: URL a la que redirigir al residente para pagar (si aplica). */
  redirectUrl: string | null
  /** Id de la solicitud de cobro, para confirmar tras el retorno. */
  paymentRequestId: string | null
  error: string | null
}

/**
 * Inicia el cobro de una cuota. `monto` opcional = saldo completo; un monto menor
 * es un ABONO parcial (el servidor lo acota al saldo). Devuelve la URL del checkout
 * (payfacs con hosted checkout) o `estado='aprobado'` directo (sandbox).
 */
export async function iniciarPagoCuota(
  cuotaId: string,
  monto?: number,
): Promise<IniciarPagoCuotaResult> {
  const base = window.location.origin
  const { data, error } = await supabase.functions.invoke('create-charge', {
    body: {
      cuota_id: cuotaId,
      ...(monto && monto > 0 ? { monto } : {}),
      url_retorno: `${base}/portal?pago=ok`,
      url_cancelacion: `${base}/portal?pago=cancelado`,
    },
  })
  if (error) return { estado: null, redirectUrl: null, paymentRequestId: null, error: await extractFunctionError(error) }
  const d = data as { estado?: string; redirectUrl?: string | null; payment_request_id?: string | null; error?: string | null } | null
  if (d?.error) return { estado: d.estado ?? 'error', redirectUrl: null, paymentRequestId: null, error: d.error }
  return {
    estado: d?.estado ?? null,
    redirectUrl: d?.redirectUrl ?? null,
    paymentRequestId: d?.payment_request_id ?? null,
    error: null,
  }
}

export interface ConfirmarPagoCuotaResult {
  estado: string | null
  /** ¿La cuota quedó liquidada (saldo 0)? */
  cuotaLiquidada: boolean
  /** Saldo que queda tras el pago (para abonos parciales). */
  saldoRestante: number | null
  error: string | null
}

/** Confirma+concilia server-side un cobro (tras el retorno del checkout). Idempotente. */
export async function confirmarPagoCuota(paymentRequestId: string): Promise<ConfirmarPagoCuotaResult> {
  const { data, error } = await supabase.functions.invoke('confirm-charge', {
    body: { payment_request_id: paymentRequestId },
  })
  if (error) return { estado: null, cuotaLiquidada: false, saldoRestante: null, error: await extractFunctionError(error) }
  const d = data as { estado?: string; cuota_liquidada?: boolean; saldo_restante?: number | null; error?: string | null } | null
  if (d?.error) return { estado: d.estado ?? 'error', cuotaLiquidada: false, saldoRestante: null, error: d.error }
  return {
    estado: d?.estado ?? null,
    cuotaLiquidada: d?.cuota_liquidada === true,
    saldoRestante: typeof d?.saldo_restante === 'number' ? d.saldo_restante : null,
    error: null,
  }
}
