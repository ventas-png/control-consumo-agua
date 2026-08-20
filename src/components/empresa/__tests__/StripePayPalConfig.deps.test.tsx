// Regresión react-hooks/exhaustive-deps (StripePayPalConfig:152).
// `cargarConfig` era una función suelta con el efecto anclado a mano a
// `[companyId]`. Ahora es un useCallback declarado por el efecto, y descarta
// la respuesta de una empresa ya abandonada.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'

const h = vi.hoisted(() => ({ fetchCompanyPaymentConfig: vi.fn() }))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../domain/cobros/paymentConfig', () => ({
  fetchCompanyPaymentConfig: h.fetchCompanyPaymentConfig,
  setCompanyProviderActivo: vi.fn(async () => ({ error: null })),
  savePaymentConfig: vi.fn(async () => ({ error: null })),
  testStripeConnection: vi.fn(async () => ({ error: null })),
}))

const { StripePayPalConfig } = await import('../StripePayPalConfig')

const VACIA = { stripe_configured: false, paypal_configured: false }

function cfg(companyId: string) {
  return <StripePayPalConfig companyId={companyId} onConfigUpdated={() => {}} />
}

beforeEach(() => {
  h.fetchCompanyPaymentConfig.mockReset()
  h.fetchCompanyPaymentConfig.mockResolvedValue({ data: VACIA })
})

afterEach(cleanup)

describe('StripePayPalConfig — el efecto declara `cargarConfig`', () => {
  it('recarga al cambiar de empresa y NO en cada render', async () => {
    const { rerender } = render(cfg('emp-1'))
    await act(async () => {})
    expect(h.fetchCompanyPaymentConfig).toHaveBeenCalledTimes(1)
    expect(h.fetchCompanyPaymentConfig).toHaveBeenCalledWith('emp-1')

    rerender(cfg('emp-1'))
    rerender(cfg('emp-1'))
    await act(async () => {})
    expect(h.fetchCompanyPaymentConfig).toHaveBeenCalledTimes(1)

    rerender(cfg('emp-2'))
    await act(async () => {})
    expect(h.fetchCompanyPaymentConfig).toHaveBeenCalledTimes(2)
    expect(h.fetchCompanyPaymentConfig).toHaveBeenLastCalledWith('emp-2')
  })

  it('descarta la respuesta de la empresa abandonada (fuera de orden)', async () => {
    let resolverPrimera: (v: unknown) => void = () => {}
    h.fetchCompanyPaymentConfig.mockImplementationOnce(() => new Promise(res => { resolverPrimera = res }))
    h.fetchCompanyPaymentConfig.mockImplementationOnce(async () => ({
      data: { ...VACIA, stripe_configured: true, stripe_public_key: 'pk_test_EMPRESA_DOS' },
    }))

    const { rerender } = render(cfg('emp-1'))
    rerender(cfg('emp-2'))
    await act(async () => {})
    const antes = document.body.innerHTML

    // Llega tarde la credencial de emp-1: no debe reemplazar la de emp-2.
    await act(async () => {
      resolverPrimera({ data: { ...VACIA, stripe_configured: true, stripe_public_key: 'pk_test_EMPRESA_UNO' } })
    })

    expect(document.body.innerHTML).toBe(antes)
    expect(screen.queryByText(/EMPRESA_UNO/)).toBeNull()
  })
})
