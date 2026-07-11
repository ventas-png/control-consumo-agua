// Cobros pluggable — lógica PURA de conciliación de pagos de cuota (F1 pago en
// línea). Vive separada del edge `confirm-charge` para testearla sin Deno/BD.

/** Redondeo monetario a 2 decimales (evita ruido de coma flotante). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export interface PlanPagoCuota {
  /** Saldo que queda tras aplicar el pago nuevo (nunca negativo). */
  saldoRestante: number
  /** ¿La cuota queda liquidada (saldo 0) con este pago? */
  liquida: boolean
  /** Tipo de aplicación del pago para `pagos.tipo_aplicacion`. */
  tipoAplicacion: 'pago_total' | 'abono'
}

/**
 * Dado el total de la cuota (con mora), los abonos ya registrados y el monto del
 * pago nuevo, calcula el saldo restante, si la cuota queda liquidada, y el tipo
 * de aplicación (pago_total si liquida, abono si no). Habilita abonos parciales.
 */
export function planPagoCuota(
  totalCuota: number,
  abonosPrevios: number,
  montoNuevo: number,
): PlanPagoCuota {
  const saldoRestante = Math.max(0, round2(totalCuota - abonosPrevios - montoNuevo))
  const liquida = saldoRestante <= 0
  return { saldoRestante, liquida, tipoAplicacion: liquida ? 'pago_total' : 'abono' }
}
