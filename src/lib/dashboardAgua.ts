// KPIs del dashboard de agua — lógica pura y testeable (auditoría 2026-07-16, D2).
//
// Dos bugs que esta extracción corrige respecto al cálculo inline anterior:
//   1. "Mes actual" filtraba solo por getMonth() sin comparar el año: con más
//      de un año de histórico, julio 2025 y julio 2026 se sumaban juntos.
//   2. new Date('YYYY-MM-DD') parsea medianoche UTC: en husos negativos
//      (GMT-6) las fechas date-only caían al día/mes anterior. parseFecha
//      (lib/format) ya resuelve esto delegando en parseFechaCalendario, que
//      construye la fecha con los componentes LOCALES de año/mes/día.
import type { Registro } from '../types'
import { calcularTotalPagar } from './business'
import { parseFecha } from './format'

const MESES_NOMBRES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

export interface ResumenDashboardAgua {
  /** Consumo (m³) del mes calendario actual — mismo mes Y mismo año. */
  consumoMes: number
  /** Recaudo del mes actual: monto_calculado o fallback calcularTotalPagar. */
  recaudoMes: number
  /** Registros en estado 'pendiente' (histórico completo, igual que antes). */
  pendientes: number
  /** Serie de consumo de los últimos 6 meses calendario (incluido el actual). */
  serie: { labels: string[]; consumo: number[] }
}

export function resumenDashboardAgua(registros: Registro[], hoy: Date = new Date()): ResumenDashboardAgua {
  // Buckets de los últimos 6 meses, clave año-mes para no mezclar años.
  const monthKeys: string[] = []
  const labels: string[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1)
    monthKeys.push(`${d.getFullYear()}-${d.getMonth()}`)
    labels.push(`${MESES_NOMBRES[d.getMonth()]} ${d.getFullYear()}`)
  }
  const buckets: Record<string, number> = {}
  monthKeys.forEach(k => { buckets[k] = 0 })

  const mesActualKey = `${hoy.getFullYear()}-${hoy.getMonth()}`
  let consumoMes = 0
  let recaudoMes = 0
  let pendientes = 0

  for (const r of registros) {
    if (r.estado === 'pendiente') pendientes++
    const f = parseFecha(r.fecha)
    if (Number.isNaN(f.getTime())) continue
    const key = `${f.getFullYear()}-${f.getMonth()}`
    const consumo = parseFloat(String(r.consumo)) || 0
    if (key in buckets) buckets[key] += consumo
    if (key === mesActualKey) {
      consumoMes += consumo
      recaudoMes += r.monto_calculado
        ?? calcularTotalPagar(r.consumo, r.tarifa_aplicada, r.canon_aplicado ?? 20).total
    }
  }

  return {
    consumoMes,
    recaudoMes,
    pendientes,
    serie: { labels, consumo: monthKeys.map(k => buckets[k]) },
  }
}
