// Cómo leer la respuesta de `pasarela_registrar_estado` ante un «aprobado».
// Lógica PURA (sin Deno ni supabase-js): la usan confirm-charge y el webhook
// de Stripe, y corre en vitest.
//
// La respuesta lleva el ESTADO PERSISTIDO de la solicitud (20261016000000):
// `conciliado`, `en_revision` y `reembolsado` se leen de las filas, también
// cuando el aviso es un duplicado. Nunca se decide por `accion`: un duplicado
// de un cobro retenido sobre una cuota anulada sigue sin acreditar.
//
// `pago_id`, `liquidado` y `saldo_restante` sólo valen si hubo conciliación;
// si faltan no se inventan (nada de saldo 0 por defecto).

export interface RespuestaRegistro {
  ok?: boolean
  accion?: string
  estado?: string
  duplicado?: boolean
  conciliado?: boolean
  en_revision?: boolean
  reembolsado?: boolean
  ya_conciliado?: boolean
  pago_id?: string | null
  liquidado?: boolean
  saldo_restante?: number | null
  incidencia_id?: string | null
}

export type LecturaConciliacion =
  | { tipo: 'conciliado'; yaConciliado: boolean; pagoId: string | null; liquidado: boolean; saldoRestante: number | null }
  | { tipo: 'en_revision'; estadoSolicitud: string; incidenciaId: string | null }
  | { tipo: 'reembolsado'; incidenciaId: string | null }
  | { tipo: 'sin_acreditar'; estadoSolicitud: string | null; incidenciaId: string | null }

export function leerConciliacion(res: RespuestaRegistro | null | undefined): LecturaConciliacion {
  const r = res ?? {}
  const incidenciaId = r.incidencia_id ?? null
  if (r.en_revision === true) {
    return { tipo: 'en_revision', estadoSolicitud: r.estado ?? 'pending_verification', incidenciaId }
  }
  if (r.reembolsado === true || r.estado === 'refunded') return { tipo: 'reembolsado', incidenciaId }
  // Con el campo persistido manda el campo. Sin él (función anterior a
  // 20261016000000) sólo cuenta como conciliado si trae el pago.
  const conciliado = typeof r.conciliado === 'boolean' ? r.conciliado : Boolean(r.pago_id)
  if (!conciliado) return { tipo: 'sin_acreditar', estadoSolicitud: r.estado ?? null, incidenciaId }
  return {
    tipo: 'conciliado',
    yaConciliado: r.ya_conciliado === true,
    pagoId: r.pago_id ?? null,
    liquidado: r.liquidado === true,
    saldoRestante: typeof r.saldo_restante === 'number' ? r.saldo_restante : null,
  }
}
