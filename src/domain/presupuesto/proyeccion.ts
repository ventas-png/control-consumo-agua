// presupuesto (D1) — Proyección de cierre de año a partir del comparativo
// presupuesto vs real (RPC presupuesto_vs_real). Lógica PURA y testeable: no
// toca red ni React. La usa PresupuestoTab para la gráfica + la proyección.
import type { PresupuestoVsRealFila } from '../../types/presupuesto'

export interface ProyeccionPresupuesto {
  /** Etiquetas 'YYYY-MM' de los 12 meses del año, en orden. */
  periodos: string[]
  /** Presupuestado por mes (0 si la partida no cubre ese mes). */
  presupuestadoMensual: number[]
  /** Real ejecutado por mes (0 si no hay pólizas publicadas ese mes). */
  ejecutadoMensual: number[]
  /** Suma presupuestada de todo el año. */
  presupuestadoAnual: number
  /** Real acumulado hasta hoy (suma de lo ejecutado). */
  ejecutadoAcum: number
  /** Meses ya transcurridos del año (0 si es futuro, 12 si es pasado). */
  mesesTranscurridos: number
  /** Proyección lineal del ejecutado a fin de año (run-rate × 12). */
  proyeccionAnual: number
  /** Desviación proyectada vs presupuesto (>0 = sobregiro esperado). */
  desviacionProyectada: number
}

/**
 * Agrega el comparativo por mes y proyecta el cierre de año con el run-rate de
 * los meses transcurridos. Para un año pasado la proyección = ejecutado real;
 * para un año futuro = presupuesto (aún no hay ejecución).
 */
export function proyeccionPresupuesto(
  filas: PresupuestoVsRealFila[],
  anio: number,
  hoy: Date = new Date(),
): ProyeccionPresupuesto {
  const periodos = Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, '0')}`)
  const idx = new Map(periodos.map((p, i) => [p, i]))

  const presupuestadoMensual = new Array(12).fill(0)
  const ejecutadoMensual = new Array(12).fill(0)
  for (const f of filas) {
    const i = idx.get(f.periodo)
    if (i === undefined) continue
    presupuestadoMensual[i] += f.presupuestado
    ejecutadoMensual[i] += f.ejecutado
  }

  const presupuestadoAnual = presupuestadoMensual.reduce((s, v) => s + v, 0)
  const ejecutadoAcum = ejecutadoMensual.reduce((s, v) => s + v, 0)

  // Meses transcurridos del AÑO del presupuesto (no del calendario actual).
  const anioActual = hoy.getFullYear()
  const mesesTranscurridos =
    anio < anioActual ? 12 : anio > anioActual ? 0 : hoy.getMonth() + 1

  const proyeccionAnual =
    mesesTranscurridos <= 0
      ? presupuestadoAnual // año futuro: sin ejecución, la mejor estimación es el plan
      : mesesTranscurridos >= 12
        ? ejecutadoAcum // año cerrado: la proyección es el real
        : (ejecutadoAcum / mesesTranscurridos) * 12 // run-rate lineal

  return {
    periodos,
    presupuestadoMensual,
    ejecutadoMensual,
    presupuestadoAnual,
    ejecutadoAcum,
    mesesTranscurridos,
    proyeccionAnual,
    desviacionProyectada: proyeccionAnual - presupuestadoAnual,
  }
}
