// Tests de la lógica pura de sync-stripe-quantities (infra:I22 · Track T8/T5,
// issue #321). Corre bajo vitest (no Deno). El cálculo de quantities y el plan
// de operaciones ya están cubiertos en _shared/__tests__/billingSync.test.ts;
// aquí se cubre lo propio de la función: normalización de los items crudos de
// Stripe (quantity ausente → 0), etiquetado de prices para billing_sync_log y
// el formato de `changes`, más el pipeline puro completo tal como lo compone
// index.ts (items crudos + uso real → operaciones de dinero contra Stripe).

import { describe, it, expect } from 'vitest'
import { computeExpectedQuantities, planSyncOps, type PlanPriceIds } from '../../_shared/billingSync.ts'
import { describeSyncOp, nameForPrice, toStripeSubItems } from '../logic.ts'

const PRICES: PlanPriceIds = {
  activation:    'price_act',
  unit_primary:  'price_up',
  extra_project: 'price_xp',
  unit_extra:    'price_ux',
}

describe('sync-stripe-quantities/toStripeSubItems', () => {
  it('acepta price como string o como objeto expandido', () => {
    const items = toStripeSubItems([
      { id: 'si_1', price: 'price_act', quantity: 1 },
      { id: 'si_2', price: { id: 'price_up' }, quantity: 42 },
    ])
    expect(items).toEqual([
      { id: 'si_1', price: { id: 'price_act' }, quantity: 1 },
      { id: 'si_2', price: { id: 'price_up' }, quantity: 42 },
    ])
  })

  it('quantity ausente o null → 0 (nunca una coincidencia silenciosa)', () => {
    const items = toStripeSubItems([
      { id: 'si_1', price: 'price_up' },
      { id: 'si_2', price: 'price_ux', quantity: null },
    ])
    expect(items[0].quantity).toBe(0)
    expect(items[1].quantity).toBe(0)
  })

  it('lista vacía → lista vacía', () => {
    expect(toStripeSubItems([])).toEqual([])
  })
})

describe('sync-stripe-quantities/nameForPrice (audit log)', () => {
  it('mapea cada price a su componente de dinero', () => {
    expect(nameForPrice('price_act', PRICES)).toBe('activation')
    expect(nameForPrice('price_up', PRICES)).toBe('unit_primary')
    expect(nameForPrice('price_xp', PRICES)).toBe('extra_project')
    expect(nameForPrice('price_ux', PRICES)).toBe('unit_extra')
  })

  it('price desconocido cae al propio priceId (la traza nunca se pierde)', () => {
    expect(nameForPrice('price_viejo_123', PRICES)).toBe('price_viejo_123')
  })
})

describe('sync-stripe-quantities/describeSyncOp (formato de changes)', () => {
  it('update lleva from → to', () => {
    expect(describeSyncOp({ kind: 'update', itemId: 'si_1', price: 'price_up', from: 50, to: 75 }))
      .toEqual({ kind: 'update', price: 'price_up', from: 50, to: 75 })
  })

  it('add solo lleva to (el item no existía)', () => {
    expect(describeSyncOp({ kind: 'add', price: 'price_ux', to: 10 }))
      .toEqual({ kind: 'add', price: 'price_ux', to: 10 })
  })

  it('remove solo lleva from (el item se elimina, no baja a 0)', () => {
    expect(describeSyncOp({ kind: 'remove', itemId: 'si_2', price: 'price_xp', from: 3 }))
      .toEqual({ kind: 'remove', price: 'price_xp', from: 3 })
  })
})

describe('sync-stripe-quantities/pipeline puro (composición de index.ts)', () => {
  it('items crudos con quantity ausente generan update desde 0 (no se omite el cobro)', () => {
    // Stripe devolvió el item primary sin quantity; el uso real es 50 unidades.
    const items = toStripeSubItems([
      { id: 'si_act', price: 'price_act', quantity: 1 },
      { id: 'si_up', price: { id: 'price_up' } }, // sin quantity
    ])
    const expected = computeExpectedQuantities({ extra_projects_count: 0, primary_units_count: 50, extra_units_count: 0 })
    const ops = planSyncOps(items, expected, PRICES)
    expect(ops).toEqual([
      { kind: 'update', itemId: 'si_up', price: 'price_up', from: 0, to: 50 },
    ])
  })

  it('uso que crece y decrece a la vez → update + add + remove etiquetados para el log', () => {
    const items = toStripeSubItems([
      { id: 'si_act', price: 'price_act', quantity: 1 },
      { id: 'si_up', price: 'price_up', quantity: 100 },
      { id: 'si_xp', price: { id: 'price_xp' }, quantity: 2 },
    ])
    const expected = computeExpectedQuantities({ extra_projects_count: 0, primary_units_count: 120, extra_units_count: 30 })
    const ops = planSyncOps(items, expected, PRICES)

    // Mismo armado de changes que hace index.ts: clave = nameForPrice, valor = describeSyncOp.
    const changes = Object.fromEntries(ops.map(op => [nameForPrice(op.price, PRICES), describeSyncOp(op)]))
    expect(changes).toEqual({
      unit_primary:  { kind: 'update', price: 'price_up', from: 100, to: 120 },
      extra_project: { kind: 'remove', price: 'price_xp', from: 2 },
      unit_extra:    { kind: 'add', price: 'price_ux', to: 30 },
    })
  })

  it('uso sin cambios → cero operaciones (no toca Stripe ni prorratea)', () => {
    const items = toStripeSubItems([
      { id: 'si_act', price: 'price_act', quantity: 1 },
      { id: 'si_up', price: 'price_up', quantity: 75 },
    ])
    const expected = computeExpectedQuantities({ extra_projects_count: 0, primary_units_count: 75, extra_units_count: 0 })
    expect(planSyncOps(items, expected, PRICES)).toEqual([])
  })
})
