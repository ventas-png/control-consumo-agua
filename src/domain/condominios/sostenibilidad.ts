import { dateLocalISO } from '../../lib/format'
import type { RegistroResiduo, TipoResiduo } from '../../types'

// ============================================================================
// Indicadores de sostenibilidad, con una sola definición para las pestañas que
// los muestran.
// ============================================================================

/**
 * Tipos que cuentan como reciclados: lo reciclable y lo electrónico, que va a
 * gestores que recuperan sus materiales. Orgánico, peligroso, escombros y
 * general no cuentan.
 *
 * Antes Residuos contaba sólo «reciclable» y Sostenibilidad sumaba también lo
 * electrónico: con los mismos registros, el % de reciclaje no coincidía entre
 * las dos pestañas.
 */
export const TIPOS_RECICLADOS: ReadonlySet<TipoResiduo> = new Set<TipoResiduo>(['reciclable', 'electronico'])

export interface ResumenReciclaje {
  /** Kg de todos los registros con cantidad. */
  totalKg: number
  /** Kg de los tipos reciclados. */
  recicladoKg: number
  /** Porcentaje reciclado (0–100); `null` si no hay kg registrados. */
  pct: number | null
}

/** Kg totales, kg reciclados y su porcentaje. Ignora cantidades vacías, cero o inválidas. */
export function resumenReciclaje(residuos: readonly RegistroResiduo[]): ResumenReciclaje {
  let totalKg = 0
  let recicladoKg = 0
  for (const r of residuos) {
    const kg = r.cantidad_kg ?? 0
    if (!Number.isFinite(kg) || kg <= 0) continue
    totalKg += kg
    if (TIPOS_RECICLADOS.has(r.tipo_residuo)) recicladoKg += kg
  }
  return { totalKg, recicladoKg, pct: totalKg > 0 ? (recicladoKg / totalKg) * 100 : null }
}

export interface VariacionMismoPeriodo {
  /** Suma del mes en curso, del día 1 a hoy. */
  actual: number
  /** Suma del mes anterior, del día 1 al mismo día (o a su último día, si es más corto). */
  anterior: number
  /** Variación porcentual; `null` si el mes anterior no tiene nada en ese periodo. */
  pct: number | null
  /** Hasta qué día se compara cada mes ('YYYY-MM-DD'). */
  hastaActual: string
  hastaAnterior: string
}

/**
 * Mes en curso contra el mismo periodo del mes anterior (del 1 al mismo día).
 *
 * Antes se comparaba el mes en curso —sin terminar— contra el promedio de doce
 * meses completos: a mitad de mes siempre salía muy por debajo y, a principio
 * de mes, cerca de −100 %.
 */
export function variacionMismoPeriodo(
  movimientos: readonly { fecha: string | null | undefined; monto: number }[],
  hoy: Date = new Date(),
): VariacionMismoPeriodo {
  const y = hoy.getFullYear()
  const m = hoy.getMonth()
  const dia = hoy.getDate()
  const ultimoDiaAnterior = new Date(y, m, 0).getDate()
  const desdeActual = dateLocalISO(new Date(y, m, 1))
  const hastaActual = dateLocalISO(new Date(y, m, dia))
  const desdeAnterior = dateLocalISO(new Date(y, m - 1, 1))
  const hastaAnterior = dateLocalISO(new Date(y, m - 1, Math.min(dia, ultimoDiaAnterior)))

  let actual = 0
  let anterior = 0
  for (const mov of movimientos) {
    const f = mov.fecha?.slice(0, 10)
    if (!f || !Number.isFinite(mov.monto)) continue
    if (f >= desdeActual && f <= hastaActual) actual += mov.monto
    else if (f >= desdeAnterior && f <= hastaAnterior) anterior += mov.monto
  }
  return { actual, anterior, pct: anterior > 0 ? ((actual - anterior) / anterior) * 100 : null, hastaActual, hastaAnterior }
}
