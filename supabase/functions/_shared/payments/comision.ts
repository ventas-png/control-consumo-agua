// Comisión transaccional de la plataforma (F7) — cálculo puro, sin Deno APIs.
//
// La config vive en `comision_config` (por empresa+canal, la fija el
// superadmin) y se lee AL CREAR el cobro: la fila del canal del proveedor
// gana; si no existe, aplica la fila 'default'; sin fila activa no hay
// comisión. El resultado se SELLA en payment_requests.comision — cambios de
// config solo afectan cobros futuros. Solo pagos de ambiente prod la generan
// (el caller decide; sandbox/demo jamás factura).

export interface ComisionConfigRow {
  canal: string
  activo: boolean
  /** Fracción (0.025 = 2.5%). */
  pct: number
  /** Monto fijo por pago, en la moneda del cobro. */
  fijo: number
}

export interface ComisionCalculada {
  /** Comisión en la moneda del cobro (2 decimales), o null si no aplica. */
  comision: number | null
  /** Config aplicada (para payment_requests.comision_detalle), o null. */
  detalle: { canal: string; pct: number; fijo: number } | null
}

const SIN_COMISION: ComisionCalculada = { comision: null, detalle: null }

function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Comisión de plataforma para un cobro de `monto` por el canal `proveedor`.
 * Prioridad: fila activa del canal > fila activa 'default' > sin comisión.
 * El resultado se acota a [0, monto] — la comisión nunca supera el pago.
 */
export function calcularComision(
  monto: number,
  proveedor: string,
  rows: ComisionConfigRow[] | null | undefined,
): ComisionCalculada {
  if (!Number.isFinite(monto) || monto <= 0) return SIN_COMISION
  const activas = (rows ?? []).filter((r) => r.activo === true)
  const cfg = activas.find((r) => r.canal === proveedor) ?? activas.find((r) => r.canal === 'default')
  if (!cfg) return SIN_COMISION

  const pct = Number.isFinite(cfg.pct) && cfg.pct > 0 ? cfg.pct : 0
  const fijo = Number.isFinite(cfg.fijo) && cfg.fijo > 0 ? cfg.fijo : 0
  if (pct === 0 && fijo === 0) return SIN_COMISION

  const bruta = redondear2(monto * pct + fijo)
  const comision = Math.min(Math.max(bruta, 0), redondear2(monto))
  return { comision, detalle: { canal: cfg.canal, pct, fijo } }
}
