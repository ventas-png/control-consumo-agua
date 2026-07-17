import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../lib/supabase', () => ({ db: {}, supabase: {} }))

import { benchmarkPorProyecto, medianaTasaCobranza } from '../benchmarking'
import type { KpiTenantMensual } from '../queries'

function row(p: Partial<KpiTenantMensual> & { project_id: string }): KpiTenantMensual {
  return {
    project_id: p.project_id, mes: p.mes ?? '2026-07',
    cuotas_count: 0, cuotas_morosas: p.cuotas_morosas ?? 0, unidades_con_deuda: 0,
    cuotas_emitido: 0, cuotas_cobrado: 0,
    agua_recibos: 0, agua_consumo_m3: p.agua_consumo_m3 ?? 0, agua_emitido: 0, agua_cobrado: 0,
    gastos_total: p.gastos_total ?? 0,
    total_emitido: p.total_emitido ?? 0, total_cobrado: p.total_cobrado ?? 0,
  }
}

describe('benchmarkPorProyecto', () => {
  const nombres = new Map([['a', 'Torre A'], ['b', 'Torre B']])

  it('agrega por proyecto sumando el rango y calcula tasa de cobranza', () => {
    const rows = [
      row({ project_id: 'a', total_emitido: 100, total_cobrado: 90, agua_consumo_m3: 10 }),
      row({ project_id: 'a', mes: '2026-06', total_emitido: 100, total_cobrado: 80, agua_consumo_m3: 5 }),
      row({ project_id: 'b', total_emitido: 200, total_cobrado: 100, cuotas_morosas: 3 }),
    ]
    const r = benchmarkPorProyecto(rows, nombres)
    // Ordenado por tasa desc: a (170/200=0.85) antes que b (100/200=0.5).
    expect(r.map(x => x.project_id)).toEqual(['a', 'b'])
    expect(r[0]).toMatchObject({ nombre: 'Torre A', emitido: 200, cobrado: 170, consumoM3: 15 })
    expect(r[0].tasaCobranza).toBeCloseTo(0.85)
    expect(r[1]).toMatchObject({ morosas: 3, tasaCobranza: 0.5 })
  })

  it('tasa de cobranza 0 cuando no hubo emisión', () => {
    const r = benchmarkPorProyecto([row({ project_id: 'a', total_emitido: 0, total_cobrado: 0 })], nombres)
    expect(r[0].tasaCobranza).toBe(0)
  })

  it('usa "Proyecto" si el nombre no está en el mapa', () => {
    const r = benchmarkPorProyecto([row({ project_id: 'z', total_emitido: 10, total_cobrado: 10 })], nombres)
    expect(r[0].nombre).toBe('Proyecto')
  })
})

describe('medianaTasaCobranza', () => {
  const bench = (tasas: number[]) => tasas.map((t, i) =>
    ({ project_id: String(i), nombre: '', emitido: 100, cobrado: t * 100, tasaCobranza: t, morosas: 0, consumoM3: 0, gastos: 0 }))

  it('mediana impar', () => { expect(medianaTasaCobranza(bench([0.9, 0.5, 0.7]))).toBeCloseTo(0.7) })
  it('mediana par (promedio de los dos centrales)', () => { expect(medianaTasaCobranza(bench([0.4, 0.6, 0.8, 1.0]))).toBeCloseTo(0.7) })
  it('excluye proyectos sin emisión', () => {
    const items = [...bench([0.8]), { project_id: 'x', nombre: '', emitido: 0, cobrado: 0, tasaCobranza: 0, morosas: 0, consumoM3: 0, gastos: 0 }]
    expect(medianaTasaCobranza(items)).toBeCloseTo(0.8)
  })
  it('0 si no hay proyectos con emisión', () => { expect(medianaTasaCobranza([])).toBe(0) })
})
