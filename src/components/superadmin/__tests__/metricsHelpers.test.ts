import { describe, it, expect } from 'vitest'
import {
  churnRatePct,
  computeArpaCents,
  computeDeltaPct,
  computeDeltaMrr,
  computeNetGrowth,
  computeConversionTrial,
  buildPlanDoughnut,
  minutosDesde,
} from '../metricsHelpers'
import type { MrrTrendPoint, TrialCohortePoint } from '../../../domain/superadmin/queries'

/** Fabrica un punto de la serie diaria (defaults neutros). */
function punto(overrides: Partial<MrrTrendPoint> & { day: string }): MrrTrendPoint {
  return {
    mrr_cents: 0,
    mrr_cobrable_cents: null,
    mrr_potencial_cents: null,
    empresas_activas: 0,
    suscripciones_vigentes: 0,
    suscripciones_trialing: null,
    ...overrides,
  }
}

/** Fabrica una cohorte (defaults en cero). */
function cohorte(overrides: Partial<TrialCohortePoint> & { mes: string }): TrialCohortePoint {
  return {
    trials: 0,
    activas_cobrables: 0,
    activas_sin_cobro: 0,
    en_trial: 0,
    trial_vencido: 0,
    pago_vencido: 0,
    canceladas: 0,
    ...overrides,
  }
}

describe('churnRatePct', () => {
  it('replica la fórmula histórica canceladas/(activas+trialing+canceladas)', () => {
    // 2 canceladas sobre 8+2+2 = 16.666… → sin redondear (el llamador formatea)
    expect(churnRatePct(8, 2, 2)).toBeCloseTo(16.6666, 3)
  })
  it('denominador 0 devuelve 0 (no NaN)', () => {
    expect(churnRatePct(0, 0, 0)).toBe(0)
  })
})

describe('computeArpaCents', () => {
  it('divide el MRR cobrable entre las cuentas de pago (excluye pilotos)', () => {
    // $172.60 entre (4 activas − 2 pilotos) = $86.30
    expect(computeArpaCents(17260, 4, 2)).toBe(8630)
  })
  it('redondea a cents', () => {
    expect(computeArpaCents(1000, 3, 0)).toBe(333)
  })
  it('denominador 0 o negativo → null', () => {
    expect(computeArpaCents(17260, 2, 2)).toBeNull()
    expect(computeArpaCents(17260, 1, 2)).toBeNull()
    expect(computeArpaCents(17260, 0, 0)).toBeNull()
  })
})

describe('computeDeltaPct', () => {
  it('serie vacía o de un punto → null', () => {
    expect(computeDeltaPct([], p => p.mrr_cents)).toBeNull()
    expect(computeDeltaPct([punto({ day: '2026-07-17', mrr_cents: 100 })], p => p.mrr_cents)).toBeNull()
  })
  it('sin punto con ≥25 días de antigüedad → null', () => {
    const serie = [
      punto({ day: '2026-07-01', mrr_cents: 100 }),
      punto({ day: '2026-07-17', mrr_cents: 150 }),
    ]
    expect(computeDeltaPct(serie, p => p.mrr_cents)).toBeNull()
  })
  it('punto base 0 → null (no Infinity)', () => {
    const serie = [
      punto({ day: '2026-06-01', mrr_cents: 0 }),
      punto({ day: '2026-07-17', mrr_cents: 150 }),
    ]
    expect(computeDeltaPct(serie, p => p.mrr_cents)).toBeNull()
  })
  it('elige el punto no-null más cercano a −30 días y calcula % a 1 decimal', () => {
    const serie = [
      punto({ day: '2026-05-01', mrr_cents: 50 }),
      punto({ day: '2026-06-16', mrr_cents: 100 }), // ~31 días antes del último
      punto({ day: '2026-07-10', mrr_cents: 140 }), // <25 días: no elegible
      punto({ day: '2026-07-17', mrr_cents: 125 }),
    ]
    expect(computeDeltaPct(serie, p => p.mrr_cents)).toBe(25)
  })
  it('ignora los puntos con valor null del accessor', () => {
    const serie = [
      punto({ day: '2026-06-15', mrr_cents: 100, mrr_cobrable_cents: 80 }),
      punto({ day: '2026-06-16', mrr_cents: 100, mrr_cobrable_cents: null }),
      punto({ day: '2026-07-17', mrr_cents: 150, mrr_cobrable_cents: 120 }),
    ]
    expect(computeDeltaPct(serie, p => p.mrr_cobrable_cents)).toBe(50)
  })
})

describe('computeDeltaMrr', () => {
  it('prefiere la serie cobrable cuando tiene historia', () => {
    const serie = [
      punto({ day: '2026-06-15', mrr_cents: 200, mrr_cobrable_cents: 100 }),
      punto({ day: '2026-07-17', mrr_cents: 220, mrr_cobrable_cents: 150 }),
    ]
    expect(computeDeltaMrr(serie)).toEqual({ pct: 50, base: 'cobrable' })
  })
  it('cae al MRR total etiquetado cuando la cobrable es toda null', () => {
    const serie = [
      punto({ day: '2026-06-15', mrr_cents: 200 }),
      punto({ day: '2026-07-17', mrr_cents: 300 }),
    ]
    expect(computeDeltaMrr(serie)).toEqual({ pct: 50, base: 'total' })
  })
  it('sin datos suficientes → null', () => {
    expect(computeDeltaMrr([])).toBeNull()
  })
})

describe('computeNetGrowth', () => {
  const hoy = new Date(2026, 6, 17) // 17 jul 2026
  it('usa el último mes COMPLETO y excluye el mes en curso', () => {
    const trends = [
      { mes: '2026-05-01', altas: 1, bajas: 0 },
      { mes: '2026-06-01', altas: 3, bajas: 1 },
      { mes: '2026-07-01', altas: 9, bajas: 0 }, // mes en curso: fuera
    ]
    expect(computeNetGrowth(trends, hoy)).toEqual({ mes: '2026-06-01', altas: 3, bajas: 1, neto: 2 })
  })
  it('neto negativo cuando hay más bajas que altas', () => {
    const trends = [{ mes: '2026-06-01', altas: 1, bajas: 4 }]
    expect(computeNetGrowth(trends, hoy)?.neto).toBe(-3)
  })
  it('serie sin meses cerrados → null', () => {
    expect(computeNetGrowth([{ mes: '2026-07-01', altas: 5, bajas: 0 }], hoy)).toBeNull()
    expect(computeNetGrowth([], hoy)).toBeNull()
  })
})

describe('computeConversionTrial', () => {
  const hoy = new Date(2026, 6, 17)
  it('convierte sobre las últimas 3 cohortes completas (cobrables + sin cobro)', () => {
    const cohortes = [
      cohorte({ mes: '2026-03-01', trials: 10, activas_cobrables: 9 }), // fuera (solo entran 3)
      cohorte({ mes: '2026-04-01', trials: 4, activas_cobrables: 1 }),
      cohorte({ mes: '2026-05-01', trials: 3, activas_sin_cobro: 1 }),
      cohorte({ mes: '2026-06-01', trials: 3, activas_cobrables: 1 }),
      cohorte({ mes: '2026-07-01', trials: 8, en_trial: 8 }), // mes en curso: fuera
    ]
    // (1+1+1) / (4+3+3) = 30%
    expect(computeConversionTrial(cohortes, hoy)).toEqual({ pct: 30, cohortes: 3 })
  })
  it('cohortes sin trials → null', () => {
    expect(computeConversionTrial([cohorte({ mes: '2026-06-01' })], hoy)).toBeNull()
    expect(computeConversionTrial([], hoy)).toBeNull()
  })
})

describe('buildPlanDoughnut', () => {
  it('ordena por count, corta en top 5 y agrega "Otros"', () => {
    const dist = [
      { planCode: 'p1', planName: 'Plan 1', count: 1 },
      { planCode: 'p2', planName: 'Plan 2', count: 9 },
      { planCode: 'p3', planName: 'Plan 3', count: 5 },
      { planCode: 'p4', planName: 'Plan 4', count: 4 },
      { planCode: 'p5', planName: 'Plan 5', count: 3 },
      { planCode: 'p6', planName: 'Plan 6', count: 2 },
      { planCode: 'p7', planName: 'Plan 7', count: 2 },
    ]
    const r = buildPlanDoughnut(dist)
    expect(r.labels).toEqual(['Plan 2', 'Plan 3', 'Plan 4', 'Plan 5', 'Plan 6', 'Otros'])
    expect(r.counts).toEqual([9, 5, 4, 3, 2, 3])
  })
  it('usa la etiqueta del code cuando falta planName', () => {
    const r = buildPlanDoughnut([{ planCode: 'bundle', planName: '', count: 2 }])
    expect(r.labels).toEqual(['Bundle Completo'])
  })
  it('lista vacía → sin labels ni "Otros"', () => {
    expect(buildPlanDoughnut([])).toEqual({ labels: [], counts: [] })
  })
})

describe('minutosDesde', () => {
  const ahora = new Date('2026-07-17T12:00:00Z')
  it('minutos redondeados desde el ISO', () => {
    expect(minutosDesde('2026-07-17T11:43:00Z', ahora)).toBe(17)
  })
  it('null/invalid → null; futuro → 0', () => {
    expect(minutosDesde(null, ahora)).toBeNull()
    expect(minutosDesde('no-es-fecha', ahora)).toBeNull()
    expect(minutosDesde('2026-07-17T12:05:00Z', ahora)).toBe(0)
  })
})
