import { describe, it, expect } from 'vitest'
import { computeExpectedQuantities, planSyncOps, planSwapItems, type StripeSubItem, type PlanPriceIds } from '../billingSync.ts'

const PRICES: PlanPriceIds = {
  activation:    'price_act',
  unit_primary:  'price_up',
  extra_project: 'price_xp',
  unit_extra:    'price_ux',
}

// Precios del NUEVO plan al que se cambia (todos distintos a PRICES).
const NEW_PRICES: PlanPriceIds = {
  activation:    'nprice_act',
  unit_primary:  'nprice_up',
  extra_project: 'nprice_xp',
  unit_extra:    'nprice_ux',
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

describe('planSwapItems (cambio de plan, P0 #1)', () => {
  const mkItem = (id: string, price: string, qty: number): StripeSubItem => ({ id, price: { id: price }, quantity: qty })

  it('swap completo: elimina todos los items del plan viejo y agrega los del nuevo', () => {
    const items = [
      mkItem('si_act', PRICES.activation, 1),
      mkItem('si_up',  PRICES.unit_primary, 50),
    ]
    const expected = { activation: 1, unit_primary: 50, extra_project: 0, unit_extra: 0 }
    const ops = planSwapItems(items, expected, NEW_PRICES)
    // los 2 viejos se eliminan, los 2 nuevos requeridos se agregan
    expect(ops).toContainEqual({ id: 'si_act', deleted: true })
    expect(ops).toContainEqual({ id: 'si_up', deleted: true })
    expect(ops).toContainEqual({ price: NEW_PRICES.activation, quantity: 1 })
    expect(ops).toContainEqual({ price: NEW_PRICES.unit_primary, quantity: 50 })
    expect(ops).toHaveLength(4)
  })

  it('swap con más componentes: mapea extra_project y unit_extra al plan nuevo', () => {
    const items = [
      mkItem('si_act', PRICES.activation, 1),
      mkItem('si_up',  PRICES.unit_primary, 50),
      mkItem('si_xp',  PRICES.extra_project, 3),
      mkItem('si_ux',  PRICES.unit_extra, 120),
    ]
    const expected = { activation: 1, unit_primary: 50, extra_project: 3, unit_extra: 120 }
    const ops = planSwapItems(items, expected, NEW_PRICES)
    // 4 deletes + 4 adds
    for (const id of ['si_act', 'si_up', 'si_xp', 'si_ux']) {
      expect(ops).toContainEqual({ id, deleted: true })
    }
    expect(ops).toContainEqual({ price: NEW_PRICES.activation, quantity: 1 })
    expect(ops).toContainEqual({ price: NEW_PRICES.unit_primary, quantity: 50 })
    expect(ops).toContainEqual({ price: NEW_PRICES.extra_project, quantity: 3 })
    expect(ops).toContainEqual({ price: NEW_PRICES.unit_extra, quantity: 120 })
    expect(ops).toHaveLength(8)
  })

  it('plan que comparte el precio de activation: conserva ese item (sin churn)', () => {
    // NEW plan reutiliza el price de activation del viejo.
    const shared: PlanPriceIds = { ...NEW_PRICES, activation: PRICES.activation }
    const items = [
      mkItem('si_act', PRICES.activation, 1),
      mkItem('si_up',  PRICES.unit_primary, 50),
    ]
    const expected = { activation: 1, unit_primary: 50, extra_project: 0, unit_extra: 0 }
    const ops = planSwapItems(items, expected, shared)
    // activation se conserva intacto (mismo precio, misma qty) → sin op.
    expect(ops).not.toContainEqual({ id: 'si_act', deleted: true })
    // unit_primary sí migra.
    expect(ops).toContainEqual({ id: 'si_up', deleted: true })
    expect(ops).toContainEqual({ price: shared.unit_primary, quantity: 50 })
    expect(ops).toHaveLength(2)
  })

  it('idempotente: si ya está en los precios nuevos con las cantidades correctas → sin ops', () => {
    const items = [
      mkItem('si_act', NEW_PRICES.activation, 1),
      mkItem('si_up',  NEW_PRICES.unit_primary, 50),
    ]
    const expected = { activation: 1, unit_primary: 50, extra_project: 0, unit_extra: 0 }
    expect(planSwapItems(items, expected, NEW_PRICES)).toEqual([])
  })

  it('reintento parcial: item ya migrado se conserva y solo se corrige la cantidad', () => {
    const items = [
      mkItem('si_act', NEW_PRICES.activation, 1),   // ya migrado
      mkItem('si_up',  NEW_PRICES.unit_primary, 40), // migrado pero qty vieja
    ]
    const expected = { activation: 1, unit_primary: 50, extra_project: 0, unit_extra: 0 }
    const ops = planSwapItems(items, expected, NEW_PRICES)
    expect(ops).toEqual([
      { id: 'si_up', price: NEW_PRICES.unit_primary, quantity: 50 },
    ])
  })

  it('elimina items huérfanos (precio que no pertenece ni al viejo ni al nuevo plan)', () => {
    const items = [
      mkItem('si_act', PRICES.activation, 1),
      mkItem('si_up',  PRICES.unit_primary, 50),
      mkItem('si_orphan', 'price_desconocido', 7),
    ]
    const expected = { activation: 1, unit_primary: 50, extra_project: 0, unit_extra: 0 }
    const ops = planSwapItems(items, expected, NEW_PRICES)
    expect(ops).toContainEqual({ id: 'si_orphan', deleted: true })
  })

  it('componente que baja a 0 en el plan nuevo: elimina el item viejo y no lo re-agrega', () => {
    const items = [
      mkItem('si_act', PRICES.activation, 1),
      mkItem('si_up',  PRICES.unit_primary, 50),
      mkItem('si_ux',  PRICES.unit_extra, 30),
    ]
    const expected = { activation: 1, unit_primary: 50, extra_project: 0, unit_extra: 0 }
    const ops = planSwapItems(items, expected, NEW_PRICES)
    expect(ops).toContainEqual({ id: 'si_ux', deleted: true })
    // no debe existir ningún add de unit_extra
    expect(ops).not.toContainEqual({ price: NEW_PRICES.unit_extra, quantity: expect.anything() })
  })

  it('dedup: dos items en el mismo precio nuevo → conserva uno, elimina el otro', () => {
    const items = [
      mkItem('si_act',  NEW_PRICES.activation, 1),
      mkItem('si_up_a', NEW_PRICES.unit_primary, 50),
      mkItem('si_up_b', NEW_PRICES.unit_primary, 50), // duplicado
    ]
    const expected = { activation: 1, unit_primary: 50, extra_project: 0, unit_extra: 0 }
    const ops = planSwapItems(items, expected, NEW_PRICES)
    expect(ops).toEqual([{ id: 'si_up_b', deleted: true }])
  })

  it('nunca deja la subscription vacía: activation y unit_primary siempre presentes tras el swap', () => {
    const items = [
      mkItem('si_act', PRICES.activation, 1),
      mkItem('si_up',  PRICES.unit_primary, 50),
    ]
    const expected = computeExpectedQuantities({ extra_projects_count: 0, primary_units_count: 0, extra_units_count: 0 })
    const ops = planSwapItems(items, expected, NEW_PRICES)
    // se agregan activation (1) y unit_primary (1) del plan nuevo
    expect(ops).toContainEqual({ price: NEW_PRICES.activation, quantity: 1 })
    expect(ops).toContainEqual({ price: NEW_PRICES.unit_primary, quantity: 1 })
  })
})
