// T7/PR3 — Contrato de las lecturas de billing SaaS (facturacion/billing):
// suscripción activa, planes y el desglose mensual (RPC). Degradan a null/[].
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state: { result: unknown; rpcResult: unknown } = { result: { data: null }, rpcResult: { data: null } }
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'maybeSingle']) builder[m] = () => builder
  builder.then = (resolve: (v: unknown) => void) => resolve(state.result)
  const rpc = vi.fn(async () => state.rpcResult)
  return { state, builder, rpc }
})

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => h.builder, rpc: h.rpc } }))

import { fetchActiveSubscription, fetchActiveBillingPlans, fetchMonthlyTotalBreakdown } from '../billing'

beforeEach(() => { h.state.result = { data: null }; h.state.rpcResult = { data: null }; h.rpc.mockClear() })

describe('fetchActiveSubscription', () => {
  it('con fila → la devuelve', async () => {
    h.state.result = { data: { status: 'active' } }
    expect(await fetchActiveSubscription('co1')).toEqual({ status: 'active' })
  })
  it('sin fila → null', async () => {
    h.state.result = { data: null }
    expect(await fetchActiveSubscription('co1')).toBeNull()
  })
})

describe('fetchActiveBillingPlans', () => {
  it('devuelve filas', async () => {
    h.state.result = { data: [{ code: 'pro' }, { code: 'basic' }] }
    expect(await fetchActiveBillingPlans()).toEqual([{ code: 'pro' }, { code: 'basic' }])
  })
  it('sin data → []', async () => {
    h.state.result = { data: null }
    expect(await fetchActiveBillingPlans()).toEqual([])
  })
})

describe('fetchMonthlyTotalBreakdown', () => {
  it('devuelve la primera fila del RPC', async () => {
    h.state.rpcResult = { data: [{ total_cents: 5000 }] }
    expect(await fetchMonthlyTotalBreakdown('co1')).toEqual({ total_cents: 5000 })
    expect(h.rpc).toHaveBeenCalledWith('calculate_monthly_total_cents', { p_company_id: 'co1' })
  })
  it('sin data → null', async () => {
    h.state.rpcResult = { data: null }
    expect(await fetchMonthlyTotalBreakdown('co1')).toBeNull()
  })
})
