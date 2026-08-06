// Cobros pluggable — lógica PURA de conciliación de pagos de cuota (F1) y de
// recibos de agua (F2). Vive separada del edge `confirm-charge` para testearla
// sin Deno/BD.

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

/**
 * F2 — ¿La factura de un recibo admite transición a 'pagada' al liquidarlo? Espeja
 * normalizarEstadoFactura + TRANSICIONES_FACTURA de src/lib/business.ts (que el edge
 * no puede importar por la frontera Deno/Vite): solo 'emitida' y 'vencida' pagan.
 * Los legacy se normalizan ('mora'→vencida, 'pagado'→pagada); null/sin factura →
 * 'pendiente', que NO transiciona (mismo guard `factura && …` que PagoModal).
 */
export function facturaTransicionaAPagada(estado: string | null | undefined): boolean {
  const e = estado === 'mora' ? 'vencida' : estado === 'pagado' ? 'pagada' : (estado ?? 'pendiente')
  return e === 'emitida' || e === 'vencida'
}

/**
 * F1 (cuotas diferenciadas) — ¿un residente con rol `callerRol` en la unidad puede
 * pagar una cuota etiquetada `rolResponsable`? Espeja EXACTAMENTE la RLS del SELECT
 * de cuotas_condominio (regla "ocultar del otro"), aplicada server-side en
 * create-charge porque el edge carga con service_role (sin RLS):
 *   • callerRol null (no es residente activo de la unidad) → NO puede.
 *   • cuota sin diferenciar (rolResponsable null/'' = responsabilidad de la unidad)
 *     → cualquier residente puede.
 *   • cuota diferenciada → solo el residente cuyo rol coincide (propietario paga las
 *     'propietario', inquilino/'arrendatario' las suyas, etc.).
 * El dueño de la unidad se modela como rol 'propietario' (unidades.cliente_id).
 */
export function residentePuedePagarCuota(
  rolResponsable: string | null | undefined,
  callerRol: string | null | undefined,
): boolean {
  if (!callerRol) return false
  if (rolResponsable == null || rolResponsable === '') return true
  return rolResponsable === callerRol
}
