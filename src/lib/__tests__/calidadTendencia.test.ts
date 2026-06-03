import { describe, it, expect } from 'vitest'
import { cumplimientoPorcentaje, serieTendencia } from '../calidadTendencia'
import type { RegistroCalidad } from '../../types'

const reg = (r: { fecha: string; cumplimiento: Record<string, boolean | null>; cumple_total?: boolean }): RegistroCalidad =>
  ({ fecha: r.fecha, cumplimiento: r.cumplimiento, cumple_total: r.cumple_total ?? false } as unknown as RegistroCalidad)

describe('cumplimientoPorcentaje (serv:S25)', () => {
  it('todos cumplen → 100', () => {
    expect(cumplimientoPorcentaje({ pH: true, turbiedad: true })).toBe(100)
  })
  it('mitad cumple → 50', () => {
    expect(cumplimientoPorcentaje({ pH: true, turbiedad: false })).toBe(50)
  })
  it('ignora los no evaluados (null)', () => {
    expect(cumplimientoPorcentaje({ pH: true, turbiedad: null, color: null })).toBe(100)
  })
  it('sin parámetros evaluados → null', () => {
    expect(cumplimientoPorcentaje({})).toBeNull()
    expect(cumplimientoPorcentaje({ pH: null })).toBeNull()
  })
})

describe('serieTendencia (serv:S25)', () => {
  it('ordena por fecha ascendente y mapea pct + cumple', () => {
    const serie = serieTendencia([
      reg({ fecha: '2026-05-20', cumplimiento: { pH: true, t: false }, cumple_total: false }),
      reg({ fecha: '2026-03-10', cumplimiento: { pH: true, t: true }, cumple_total: true }),
    ])
    expect(serie.map(p => p.fecha)).toEqual(['2026-03-10', '2026-05-20'])
    expect(serie[0]).toMatchObject({ pct: 100, cumple: true })
    expect(serie[1]).toMatchObject({ pct: 50, cumple: false })
  })

  it('omite análisis sin parámetros evaluables', () => {
    const serie = serieTendencia([
      reg({ fecha: '2026-05-01', cumplimiento: {} }),
      reg({ fecha: '2026-05-02', cumplimiento: { pH: true } }),
    ])
    expect(serie).toHaveLength(1)
    expect(serie[0].fecha).toBe('2026-05-02')
  })

  it('lista vacía → serie vacía', () => {
    expect(serieTendencia([])).toEqual([])
  })
})
