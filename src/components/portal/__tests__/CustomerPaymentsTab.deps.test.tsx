// Regresión react-hooks/exhaustive-deps (CustomerPaymentsTab:54).
// `cargarConfig` era una función suelta y el efecto llevaba `[companyId]` a
// mano. Con `useCallback` + `[cargarConfig]` la relación es explícita, y la
// bandera de cancelación evita que la config de una empresa anterior pise la
// actual cuando las respuestas llegan fuera de orden (el portal resuelve
// `companyId` de forma asíncrona, así que el cambio undefined → id es la norma).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import type { Registro, UserSession } from '../../../types'

const h = vi.hoisted(() => ({
  fetchPortalPaymentConfig: vi.fn(),
  fetchPortalRecargoTarjeta: vi.fn(async () => []),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../domain/portal/queries', () => ({
  fetchPortalPaymentConfig: h.fetchPortalPaymentConfig,
  fetchPortalRecargoTarjeta: h.fetchPortalRecargoTarjeta,
}))
vi.mock('../PagoEnLineaModal', () => ({ PagoEnLineaModal: () => null }))
vi.mock('../PagoManualModal', () => ({ PagoManualModal: () => null }))

const { CustomerPaymentsTab } = await import('../CustomerPaymentsTab')

const currentUser = { user_id: 'u1', role: 'cliente' } as unknown as UserSession
const registros: Registro[] = []

const CONFIG_SANDBOX = {
  stripe_configured: false, stripe_activo: false,
  paypal_configured: false, paypal_activo: false,
  proveedor_pago: 'sandbox', pago_sandbox_demo: false,
}

function tab(companyId?: string) {
  return (
    <CustomerPaymentsTab
      registros={registros} clientes={[]} currentUser={currentUser}
      companyId={companyId} moneda="Q"
    />
  )
}

beforeEach(() => {
  h.fetchPortalPaymentConfig.mockReset()
  h.fetchPortalRecargoTarjeta.mockClear()
  h.fetchPortalPaymentConfig.mockResolvedValue(CONFIG_SANDBOX)
})

afterEach(cleanup)

describe('CustomerPaymentsTab — el efecto declara `cargarConfig`', () => {
  it('carga la config cuando el portal resuelve la empresa (undefined → id)', async () => {
    const { rerender } = render(tab(undefined))
    await act(async () => {})
    expect(h.fetchPortalPaymentConfig).not.toHaveBeenCalled()

    rerender(tab('emp-1'))
    await act(async () => {})

    expect(h.fetchPortalPaymentConfig).toHaveBeenCalledWith('emp-1')
  })

  it('recarga al cambiar de empresa y NO en cada render', async () => {
    const { rerender } = render(tab('emp-1'))
    await act(async () => {})
    expect(h.fetchPortalPaymentConfig).toHaveBeenCalledTimes(1)

    rerender(tab('emp-1'))
    rerender(tab('emp-1'))
    await act(async () => {})
    expect(h.fetchPortalPaymentConfig).toHaveBeenCalledTimes(1)

    rerender(tab('emp-2'))
    await act(async () => {})
    expect(h.fetchPortalPaymentConfig).toHaveBeenCalledTimes(2)
    expect(h.fetchPortalPaymentConfig).toHaveBeenLastCalledWith('emp-2')
  })

  it('descarta la config de la empresa abandonada (respuesta fuera de orden)', async () => {
    let resolverPrimera: (v: unknown) => void = () => {}
    h.fetchPortalPaymentConfig.mockImplementationOnce(() => new Promise(res => { resolverPrimera = res }))
    h.fetchPortalPaymentConfig.mockImplementationOnce(async () => ({
      ...CONFIG_SANDBOX, proveedor_pago: 'qpaypro',
    }))

    const { rerender } = render(tab('emp-1'))
    rerender(tab('emp-2'))
    await act(async () => {})
    const antes = document.body.innerHTML

    // Respuesta tardía de emp-1: el cleanup ya la canceló, la vista no cambia.
    await act(async () => { resolverPrimera({ ...CONFIG_SANDBOX, proveedor_pago: 'ninguno' }) })

    expect(document.body.innerHTML).toBe(antes)
  })

  it('sin empresa resuelta sale del estado de carga sin consultar', async () => {
    render(tab(undefined))
    await act(async () => {})
    expect(h.fetchPortalPaymentConfig).not.toHaveBeenCalled()
    expect(screen.queryByText(/Cargando/i)).toBeNull()
  })
})
