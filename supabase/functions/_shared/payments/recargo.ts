// Recargo por pago con tarjeta al CLIENTE FINAL — cálculo puro, sin Deno APIs.
//
// La config vive en `recargo_tarjeta_config` (por empresa+canal, la fija el
// TENANT: es su contrato con el payfac) y se lee AL CREAR el cobro: el
// proveedor cobra monto + recargo, y el resultado se SELLA en
// payment_requests.recargo. El abono al recibo/cuota sigue siendo el monto
// base — la conciliación de confirm-charge usa payment_requests.monto.
//
// Misma aritmética por canal que la comisión F7 (pct + fijo; fila del canal >
// 'default' > nada), pero semántica OPUESTA: la comisión es un ledger de la
// plataforma facturable al tenant; el recargo lo paga el cliente final.
// Aplica en TODOS los ambientes (es el total del checkout, no facturación).
import { calcularComision, type ComisionConfigRow } from './comision.ts'

export type RecargoConfigRow = ComisionConfigRow

export interface RecargoCalculado {
  /** Recargo en la moneda del cobro (2 decimales), o null si no aplica. */
  recargo: number | null
  /** Config aplicada (para payment_requests.recargo_detalle), o null. */
  detalle: { canal: string; pct: number; fijo: number } | null
}

/**
 * Recargo de tarjeta para un cobro de `monto` por el canal `proveedor`.
 * Prioridad: fila activa del canal > fila activa 'default' > sin recargo.
 * Acotado a [0, monto] (herencia del cálculo compartido).
 */
export function calcularRecargo(
  monto: number,
  proveedor: string,
  rows: RecargoConfigRow[] | null | undefined,
): RecargoCalculado {
  const r = calcularComision(monto, proveedor, rows)
  return { recargo: r.comision, detalle: r.detalle }
}

/** Total que cobra el proveedor: monto base + recargo, a 2 decimales. */
export function totalConRecargo(monto: number, recargo: number | null): number {
  return Math.round((monto + (recargo ?? 0) + Number.EPSILON) * 100) / 100
}
