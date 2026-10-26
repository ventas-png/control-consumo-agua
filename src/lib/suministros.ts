// Rendimiento y consumo de un suministro — aritmética pura sobre la ficha y
// sus movimientos. Nada de aquí toca la red: la pantalla lo llama con lo que
// ya tiene cargado y la base no guarda ningún derivado (20261109000000).
import type { MovimientoSuministro, SuministroCondominio } from '../types'

/**
 * Unidades sugeridas para el rendimiento. Es texto libre: la lista sólo
 * ayuda a escribirlo igual de una ficha a otra.
 */
export const UNIDADES_RENDIMIENTO = ['usos', 'aplicaciones', 'limpiezas', 'tareas', 'm²', 'días'] as const

type FichaRendimiento = Pick<SuministroCondominio,
  'unidad_medida' | 'stock_actual' | 'stock_minimo' | 'costo_unitario' | 'rendimiento' | 'rendimiento_unidad'>

export interface RendimientoSuministro {
  /** Cuántos usos da UNA unidad de medida. */
  porUnidad: number
  /** En qué se mide el uso (`usos` si la ficha no lo dice). */
  unidad: string
  /** stock_actual × porUnidad. */
  usosDisponibles: number
  /** stock_minimo × porUnidad: por debajo de esto el insumo está en alerta. */
  usosMinimo: number
  /** costo_unitario ÷ porUnidad; null si la ficha no tiene costo. */
  costoPorUso: number | null
}

const redondear = (n: number, decimales = 2) => {
  const f = 10 ** decimales
  return Math.round(n * f) / f
}

/** Número sin ceros de relleno: 40 → «40», 2.5 → «2.5», 0.1499 → «0.15». */
export function fmtRendimiento(n: number, decimales = 2): string {
  return String(redondear(n, decimales))
}

/** null cuando la ficha no declara rendimiento (o lo declara inválido). */
export function rendimientoSuministro(s: FichaRendimiento): RendimientoSuministro | null {
  const r = s.rendimiento
  if (r == null || !Number.isFinite(r) || r <= 0) return null
  const costo = s.costo_unitario
  return {
    porUnidad: r,
    unidad: s.rendimiento_unidad?.trim() || 'usos',
    usosDisponibles: redondear(s.stock_actual * r),
    usosMinimo: redondear(s.stock_minimo * r),
    costoPorUso: costo != null && Number.isFinite(costo) && costo >= 0 ? redondear(costo / r, 4) : null,
  }
}

/** «1 litro rinde 40 aplicaciones» — null si no hay rendimiento. */
export function describirRendimiento(s: FichaRendimiento): string | null {
  const r = rendimientoSuministro(s)
  if (!r) return null
  return `1 ${s.unidad_medida} rinde ${fmtRendimiento(r.porUnidad)} ${r.unidad}`
}

export interface ConsumoObservado {
  /** Tamaño de la ventana, en días (hoy incluido). */
  dias: number
  /** Cuántas salidas hubo en la ventana. */
  movimientos: number
  /** Suma de las salidas en la ventana, en unidad_medida. */
  salidas: number
  /** salidas ÷ dias. */
  porDia: number
  /** Días que duraría el stock actual al ritmo observado; null sin consumo. */
  diasCobertura: number | null
}

/** `iso` menos `n` días, en 'YYYY-MM-DD' (aritmética UTC: sin saltos de zona). */
export function restarDiasISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/**
 * Lo que se ha consumido de verdad: sólo movimientos `salida` con fecha en
 * los últimos `dias` días (hoy incluido). Las entradas reponen y los ajustes
 * corrigen; ninguno de los dos es consumo.
 */
export function consumoObservado(
  stockActual: number,
  movimientos: Pick<MovimientoSuministro, 'tipo' | 'cantidad' | 'fecha'>[],
  hoy: string,
  dias = 30,
): ConsumoObservado {
  const desde = restarDiasISO(hoy, dias - 1)
  let salidas = 0
  let n = 0
  for (const m of movimientos) {
    if (m.tipo !== 'salida') continue
    if (m.fecha < desde || m.fecha > hoy) continue
    salidas += Number(m.cantidad) || 0
    n += 1
  }
  const porDia = dias > 0 ? salidas / dias : 0
  return {
    dias,
    movimientos: n,
    salidas: redondear(salidas),
    porDia: redondear(porDia, 4),
    diasCobertura: porDia > 0 ? Math.floor(stockActual / porDia) : null,
  }
}
