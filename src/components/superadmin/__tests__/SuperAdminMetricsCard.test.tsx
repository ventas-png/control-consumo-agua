import { describe, it, expect, vi } from 'vitest'

// El modulo importa supabase que requiere env vars en el side-effect import.
// Mockeamos antes de que el modulo bajo test se importe.
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))

const { computeMetrics } = await import('../SuperAdminMetricsCard')

const PLAN_AGUA = { id: 'p1', code: 'agua', name: 'Solo Agua', price_monthly_cents: 5000 }
const PLAN_COND = { id: 'p2', code: 'cond', name: 'Solo Condominios', price_monthly_cents: 8000 }
const PLAN_FULL = { id: 'p3', code: 'full', name: 'Completo', price_monthly_cents: 12000 }

function row(overrides: Record<string, unknown> = {}) {
  return {
    status: 'active',
    canceled_at: null,
    plan: PLAN_AGUA,
    ...overrides,
  } as Parameters<typeof computeMetrics>[0][number]
}

const FIVE_DAYS_AGO = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
const FORTY_DAYS_AGO = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()

describe('computeMetrics', () => {
  it('devuelve ceros con array vacio', () => {
    const m = computeMetrics([])
    expect(m.mrrCents).toBe(0)
    expect(m.activeCount).toBe(0)
    expect(m.trialingCount).toBe(0)
    expect(m.cancelledLast30Days).toBe(0)
    expect(m.planDistribution).toEqual([])
  })

  it('suma MRR de subscriptions active', () => {
    const m = computeMetrics([
      row({ plan: PLAN_AGUA }),
      row({ plan: PLAN_COND }),
      row({ plan: PLAN_FULL }),
    ])
    expect(m.mrrCents).toBe(5000 + 8000 + 12000)
    expect(m.activeCount).toBe(3)
  })

  it('incluye trialing en MRR pero las cuenta aparte', () => {
    const m = computeMetrics([
      row({ status: 'trialing', plan: PLAN_AGUA }),
      row({ status: 'active', plan: PLAN_COND }),
    ])
    expect(m.mrrCents).toBe(5000 + 8000)
    expect(m.activeCount).toBe(1)
    expect(m.trialingCount).toBe(1)
  })

  it('excluye canceled del MRR', () => {
    const m = computeMetrics([
      row({ status: 'canceled', plan: PLAN_AGUA, canceled_at: FIVE_DAYS_AGO }),
      row({ status: 'active', plan: PLAN_COND }),
    ])
    expect(m.mrrCents).toBe(8000) // solo el active
    expect(m.cancelledLast30Days).toBe(1)
  })

  it('excluye canceled mas viejos que 30 dias del churn', () => {
    const m = computeMetrics([
      row({ status: 'canceled', plan: PLAN_AGUA, canceled_at: FORTY_DAYS_AGO }),
      row({ status: 'canceled', plan: PLAN_COND, canceled_at: FIVE_DAYS_AGO }),
    ])
    expect(m.cancelledLast30Days).toBe(1)
  })

  it('agrupa por plan y ordena por count desc', () => {
    const m = computeMetrics([
      row({ plan: PLAN_AGUA }),
      row({ plan: PLAN_AGUA }),
      row({ plan: PLAN_COND }),
      row({ plan: PLAN_AGUA }),
    ])
    expect(m.planDistribution).toHaveLength(2)
    expect(m.planDistribution[0]).toEqual({ planCode: 'agua', planName: 'Solo Agua', count: 3 })
    expect(m.planDistribution[1]).toEqual({ planCode: 'cond', planName: 'Solo Condominios', count: 1 })
  })

  it('totalSubscriptions es active + trialing (sin canceled)', () => {
    const m = computeMetrics([
      row({ status: 'active', plan: PLAN_AGUA }),
      row({ status: 'trialing', plan: PLAN_COND }),
      row({ status: 'canceled', plan: PLAN_FULL, canceled_at: FIVE_DAYS_AGO }),
    ])
    expect(m.totalSubscriptions).toBe(2)
  })

  it('rows sin plan no contaminan MRR ni distribution', () => {
    const m = computeMetrics([
      row({ status: 'active', plan: null }),
      row({ status: 'active', plan: PLAN_AGUA }),
    ])
    expect(m.mrrCents).toBe(5000)
    expect(m.activeCount).toBe(2) // ambos cuentan en activeCount
    expect(m.planDistribution).toHaveLength(1)
  })

  it('loading=false y error=null tras calcular', () => {
    const m = computeMetrics([row()])
    expect(m.loading).toBe(false)
    expect(m.error).toBeNull()
  })
})
