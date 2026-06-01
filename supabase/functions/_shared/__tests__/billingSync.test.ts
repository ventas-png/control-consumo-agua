import { describe, it, expect } from 'vitest'
import { computeExpectedQuantities, planSyncOps, type StripeSubItem, type PlanPriceIds } from '../billingSync.ts'

const PRICES: PlanPriceIds = {
  activation:    'price_act',
  unit_primary:  'price_up',
  extra_project: 'price_xp',
  unit_extra:    'price_ux',
}

describe('computeExpectedQuantities', () => {
  it('activation siempre 1', () => {
    expect(computeExpectedQuantities({ extra_projects_count: 0, primary_units_count: 0, extra_units_count: 0 }).activation).toBe(1)
  })

  it('unit_primary minimo 1 (Stripe no acepta quantity=0 en item required)', () => {
    expect(computeExpectedQuantities({ extra_projects_count: 0, primary_units_count: 0, extra_units_count: 0 }).unit_primary).toBe(1)
  })

  it('extra_project y unit_extra reflejan el conteo crudo', () => {
    const out = computeExpectedQuantities({ extra_projects_count: 3, primary_units_count: 50, extra_units_count: 120 })
    expect(out).toEqual({ activation: 1, unit_primary: 50, extra_project: 3, unit_extra: 120 })
  })

  it('clamp a >=0 en componentes opcionales (defensivo contra valores negativos del RPC)', () => {
    const out = computeExpectedQuantities({ extra_projects_count: -2, primary_units_count: -5, extra_units_count: -1 })
    expect(out).toEqual({ activation: 1, unit_primary: 1, extra_project: 0, unit_extra: 0 })
  })
})

describe('planSyncOps', () => {
  const mkItem = (id: string, price: string, qty: number): StripeSubItem => ({ id, price: { id: price }, quantity: qty })

  it('no devuelve ops cuando todos los items coinciden', () => {
    const items = [
      mkItem('si_act', PRICES.activation, 1),
      mkItem('si_up',  PRICES.unit_primary, 50),
    ]
    const expected = { activation: 1, unit_primary: 50, extra_project: 0, unit_extra: 0 }
    expect(planSyncOps(items, expected, PRICES)).toEqual([])
  })

  it('emite update cuando una quantity difiere', () => {
    const items = [
      mkItem('si_act', PRICES.activation, 1),
      mkItem('si_up',  PRICES.unit_primary, 50),
    ]
    const expected = { activation: 1, unit_primary: 75, extra_project: 0, unit_extra: 0 }
    const ops = planSyncOps(items, expected, PRICES)
    expect(ops).toEqual([
      { kind: 'update', itemId: 'si_up', price: PRICES.unit_primary, from: 50, to: 75 },
    ])
  })

  it('emite add cuando el componente paso de 0 a >0 (item no existia en Stripe)', () => {
    const items = [
      mkItem('si_act', PRICES.activation, 1),
      mkItem('si_up',  PRICES.unit_primary, 50),
    ]
    const expected = { activation: 1, unit_primary: 50, extra_project: 2, unit_extra: 0 }
    const ops = planSyncOps(items, expected, PRICES)
    expect(ops).toEqual([
      { kind: 'add', price: PRICES.extra_project, to: 2 },
    ])
  })

  it('emite remove cuando un componente bajo a 0 (Stripe necesita delete del item)', () => {
    const items = [
      mkItem('si_act', PRICES.activation, 1),
      mkItem('si_up',  PRICES.unit_primary, 50),
      mkItem('si_ux',  PRICES.unit_extra, 30),
    ]
    const expected = { activation: 1, unit_primary: 50, extra_project: 0, unit_extra: 0 }
    const ops = planSyncOps(items, expected, PRICES)
    expect(ops).toEqual([
      { kind: 'remove', itemId: 'si_ux', price: PRICES.unit_extra, from: 30 },
    ])
  })

  it('combina add + update + remove en el mismo run', () => {
    const items = [
      mkItem('si_act', PRICES.activation, 1),
      mkItem('si_up',  PRICES.unit_primary, 50),
      mkItem('si_xp',  PRICES.extra_project, 5),
    ]
    const expected = { activation: 1, unit_primary: 75, extra_project: 0, unit_extra: 10 }
    const ops = planSyncOps(items, expected, PRICES)
    expect(ops).toContainEqual({ kind: 'update', itemId: 'si_up', price: PRICES.unit_primary, from: 50, to: 75 })
    expect(ops).toContainEqual({ kind: 'remove', itemId: 'si_xp', price: PRICES.extra_project, from: 5 })
    expect(ops).toContainEqual({ kind: 'add', price: PRICES.unit_extra, to: 10 })
    expect(ops).toHaveLength(3)
  })

  it('no emite add cuando wanted=0 y el item no existia (no-op)', () => {
    const items = [
      mkItem('si_act', PRICES.activation, 1),
      mkItem('si_up',  PRICES.unit_primary, 50),
    ]
    const expected = { activation: 1, unit_primary: 50, extra_project: 0, unit_extra: 0 }
    expect(planSyncOps(items, expected, PRICES)).toEqual([])
  })
})
