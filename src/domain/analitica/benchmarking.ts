// analitica (D4) — Benchmarking entre proyectos del mismo tenant a partir de las
// filas mensuales de la MV (get_kpis_tenant_mensual). Lógica PURA y testeable:
// agrega por proyecto sobre el rango y deriva ratios comparables.
import type { KpiTenantMensual } from './queries'

export interface BenchmarkProyecto {
  project_id: string
  nombre: string
  emitido: number
  cobrado: number
  /** cobrado / emitido en [0,1]; 0 si no hubo emisión. */
  tasaCobranza: number
  morosas: number
  consumoM3: number
  gastos: number
}

/**
 * Agrupa las filas (proyecto, mes) por proyecto sumando los importes del rango y
 * calcula la tasa de cobranza combinada (cuotas + agua). Ordena por tasa de
 * cobranza desc (mejor desempeño primero). `nombres` resuelve el id → nombre.
 */
export function benchmarkPorProyecto(
  rows: KpiTenantMensual[],
  nombres: Map<string, string>,
): BenchmarkProyecto[] {
  const acc = new Map<string, BenchmarkProyecto>()
  for (const r of rows) {
    const cur = acc.get(r.project_id) ?? {
      project_id: r.project_id,
      nombre: nombres.get(r.project_id) ?? 'Proyecto',
      emitido: 0, cobrado: 0, tasaCobranza: 0, morosas: 0, consumoM3: 0, gastos: 0,
    }
    cur.emitido += r.total_emitido
    cur.cobrado += r.total_cobrado
    cur.morosas += r.cuotas_morosas
    cur.consumoM3 += r.agua_consumo_m3
    cur.gastos += r.gastos_total
    acc.set(r.project_id, cur)
  }
  const out = [...acc.values()]
  for (const p of out) p.tasaCobranza = p.emitido > 0 ? p.cobrado / p.emitido : 0
  return out.sort((a, b) => b.tasaCobranza - a.tasaCobranza)
}

/** Mediana de la tasa de cobranza del portafolio — línea de referencia. */
export function medianaTasaCobranza(items: BenchmarkProyecto[]): number {
  const vals = items.filter(p => p.emitido > 0).map(p => p.tasaCobranza).sort((a, b) => a - b)
  if (vals.length === 0) return 0
  const mid = Math.floor(vals.length / 2)
  return vals.length % 2 === 1 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2
}
