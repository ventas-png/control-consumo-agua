import type { RegistroCalidad } from '../types'

// serv:S25 — Histórico/tendencia de calidad por fuente. Lógica pura (testeable):
// convierte los registros de calidad en una serie temporal del % de parámetros
// que cumplen, para graficar la evolución de una fuente.

export interface PuntoTendencia {
  fecha: string
  /** % de parámetros que cumplen entre los evaluados (0-100). */
  pct: number
  /** cumplimiento total del análisis (todos los parámetros en norma). */
  cumple: boolean
}

/**
 * % de parámetros que cumplen entre los evaluados (no-null). Devuelve null si el
 * análisis no tiene ningún parámetro evaluado.
 */
export function cumplimientoPorcentaje(cumplimiento: Record<string, boolean | null>): number | null {
  const evaluados = Object.values(cumplimiento).filter((v): v is boolean => v !== null)
  if (evaluados.length === 0) return null
  const ok = evaluados.filter(Boolean).length
  return Math.round((ok / evaluados.length) * 100)
}

/**
 * Serie de tendencia ordenada por fecha ascendente. Omite registros sin
 * parámetros evaluables (pct null).
 */
export function serieTendencia(registros: RegistroCalidad[]): PuntoTendencia[] {
  return registros
    .map((r): PuntoTendencia | null => {
      const pct = cumplimientoPorcentaje(r.cumplimiento ?? {})
      return pct === null ? null : { fecha: r.fecha, pct, cumple: !!r.cumple_total }
    })
    .filter((p): p is PuntoTendencia => p !== null)
    .sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime())
}
