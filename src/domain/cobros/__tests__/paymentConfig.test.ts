// T7/PR3 — Contrato de la config de proveedores de pago (cobros/paymentConfig):
// lectura/escritura de `companies`, edges save-payment-config/test-stripe y el
// override crudo de `projects.proveedor_pago` (vía runQuery). Mock encadenable
// thenable + functions.invoke.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state: { result: unknown } = { result: { data: null, error: null } }
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'update', 'eq', 'single', 'limit', 'abortSignal']) {
    builder[m] = () => builder
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(state.result)
  const invoke = vi.fn()
  return { state, builder, invoke }
})

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => h.builder, functions: { invoke: h.invoke } },
}))

import {
  fetchCompanyPaymentConfig,
  setCompanyProviderActivo,
  savePaymentConfig,
  testStripeConnection,
  fetchProjectProveedorPagoOverride,
} from '../paymentConfig'

beforeEach(() => {
  h.state.result = { data: null, error: null }
  h.invoke.mockReset()
})

describe('fetchCompanyPaymentConfig', () => {
  it('éxito → { data, error: null }', async () => {
    h.state.result = { data: { stripe_activo: true, paypal_activo: false }, error: null }
    expect(await fetchCompanyPaymentConfig('co1')).toEqual({
      data: { stripe_activo: true, paypal_activo: false }, error: null,
    })
  })

  it('error → mensaje legible', async () => {
    h.state.result = { data: null, error: { message: 'rls' } }
    expect(await fetchCompanyPaymentConfig('co1')).toEqual({ data: null, error: 'rls' })
  })
})

describe('setCompanyProviderActivo', () => {
  it('éxito → { error: null }', async () => {
    h.state.result = { error: null }
    expect(await setCompanyProviderActivo('co1', { stripe_activo: false })).toEqual({ error: null })
  })

  it('error → mensaje legible', async () => {
    h.state.result = { error: { message: 'denied' } }
    expect(await setCompanyProviderActivo('co1', { paypal_activo: true })).toEqual({ error: 'denied' })
  })
})

describe('savePaymentConfig', () => {
  it('éxito → invoca save-payment-config con el body', async () => {
    h.invoke.mockResolvedValueOnce({ error: null })
    expect(await savePaymentConfig({ companyId: 'co1', provider: 'stripe', publicKey: 'pk', secretKey: 'sk' }))
      .toEqual({ error: null })
    expect(h.invoke).toHaveBeenCalledWith('save-payment-config', {
      body: { companyId: 'co1', provider: 'stripe', publicKey: 'pk', secretKey: 'sk' },
    })
  })

  it('error del edge → mensaje legible', async () => {
    h.invoke.mockResolvedValueOnce({ error: { message: 'bad key' } })
    expect(await savePaymentConfig({ companyId: 'co1', provider: 'paypal', publicKey: 'id', secretKey: 's' }))
      .toEqual({ error: 'bad key' })
  })
})

describe('testStripeConnection', () => {
  it('éxito → { error: null } e invoca test-stripe', async () => {
    h.invoke.mockResolvedValueOnce({ error: null })
    expect(await testStripeConnection('co1')).toEqual({ error: null })
    expect(h.invoke).toHaveBeenCalledWith('test-stripe', { body: { companyId: 'co1' } })
  })

  it('error → mensaje legible', async () => {
    h.invoke.mockResolvedValueOnce({ error: { message: 'no keys' } })
    expect(await testStripeConnection('co1')).toEqual({ error: 'no keys' })
  })
})

describe('fetchProjectProveedorPagoOverride', () => {
  it('con fila → { proveedorPago }', async () => {
    h.state.result = { data: [{ proveedor_pago: 'qpaypro' }], error: null }
    expect(await fetchProjectProveedorPagoOverride('p1')).toEqual({ proveedorPago: 'qpaypro' })
  })

  it('fila con proveedor_pago null → hereda (null)', async () => {
    h.state.result = { data: [{ proveedor_pago: null }], error: null }
    expect(await fetchProjectProveedorPagoOverride('p1')).toEqual({ proveedorPago: null })
  })

  it('sin filas → null', async () => {
    h.state.result = { data: [], error: null }
    expect(await fetchProjectProveedorPagoOverride('p1')).toBeNull()
  })
})
