import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const { mockInvoke, mockRefresh } = vi.hoisted(() => ({ mockInvoke: vi.fn(), mockRefresh: vi.fn() }))

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    functions: { invoke: mockInvoke },
  },
}))

vi.mock('../Dialog', () => ({
  notify: vi.fn(),
}))

vi.mock('../../../lib/featureFlags', () => ({
  useFeatureFlags: () => ({ planName: 'Solo Agua', flags: new Set(), has: () => false, loading: false, planCode: 'agua_only', refresh: mockRefresh }),
}))

import { UpgradeCTA } from '../UpgradeCTA'
import { notify } from '../Dialog'

beforeEach(() => {
  cleanup()
  mockInvoke.mockReset()
  mockRefresh.mockReset()
  vi.mocked(notify).mockReset()
})

describe('UpgradeCTA — render', () => {
  it('renderiza feature name y descripcion', () => {
    render(<UpgradeCTA feature="Asambleas digitales" description="Vota online" />)
    expect(screen.getByText(/Asambleas digitales no incluido/)).toBeDefined()
    expect(screen.getByText('Vota online')).toBeDefined()
  })

  it('renderiza plan actual y requerido', () => {
    render(<UpgradeCTA feature="X" requiredPlan="Bundle" />)
    expect(screen.getByText(/Solo Agua/)).toBeDefined()
    expect(screen.getByText(/Bundle/)).toBeDefined()
  })
})

describe('UpgradeCTA — onUpgrade override', () => {
  it('invoca el handler custom en lugar de stripe checkout', async () => {
    const onUpgrade = vi.fn()
    render(<UpgradeCTA feature="X" onUpgrade={onUpgrade} />)
    fireEvent.click(screen.getByRole('button', { name: /Actualizar plan/i }))
    expect(onUpgrade).toHaveBeenCalledTimes(1)
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})

describe('UpgradeCTA — stripe checkout flow', () => {
  it('invoca create-checkout-session con plan_code default', async () => {
    mockInvoke.mockResolvedValue({ data: { url: 'https://checkout.stripe.com/abc' }, error: null })
    render(<UpgradeCTA feature="X" />)
    fireEvent.click(screen.getByRole('button', { name: /Actualizar plan/i }))

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1))
    expect(mockInvoke).toHaveBeenCalledWith('create-checkout-session', expect.objectContaining({
      body: expect.objectContaining({
        plan_code: 'bundle',
        billing_cycle: 'monthly',
      }),
    }))
    // Nota: redireccion via window.location.href no es testeable trivialmente
    // en jsdom (read-only). Verificamos solo el invoke; el href = url es
    // una asignacion directa sin logica adicional.
  })

  it('respeta targetPlanCode y billingCycle custom', async () => {
    mockInvoke.mockResolvedValue({ data: { url: 'https://checkout.stripe.com/x' }, error: null })
    render(<UpgradeCTA feature="X" targetPlanCode="agua_only" billingCycle="yearly" />)
    fireEvent.click(screen.getByRole('button', { name: /Actualizar plan/i }))

    await waitFor(() => expect(mockInvoke).toHaveBeenCalled())
    expect(mockInvoke).toHaveBeenCalledWith('create-checkout-session', expect.objectContaining({
      body: expect.objectContaining({
        plan_code: 'agua_only',
        billing_cycle: 'yearly',
      }),
    }))
  })

  it('muestra notify con error si edge function falla', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'Stripe no configurado' } })
    render(<UpgradeCTA feature="X" />)
    fireEvent.click(screen.getByRole('button', { name: /Actualizar plan/i }))

    await waitFor(() => expect(notify).toHaveBeenCalled())
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'error',
      title: expect.stringContaining('checkout'),
    }))
  })

  it('muestra notify si no hay URL en la respuesta', async () => {
    mockInvoke.mockResolvedValue({ data: { url: null }, error: null })
    render(<UpgradeCTA feature="X" />)
    fireEvent.click(screen.getByRole('button', { name: /Actualizar plan/i }))

    await waitFor(() => expect(notify).toHaveBeenCalled())
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }))
  })
})

describe('UpgradeCTA — cambio de plan in-place (swapped)', () => {
  it('swapped:true muestra ÉXITO (no error) y refresca los feature flags', async () => {
    // P0 #1: company con suscripción activa → el edge hace el swap con
    // prorrateo y responde { swapped: true } sin URL. Antes este camino
    // mostraba "No se obtuvo URL de checkout" tras cobrar el upgrade.
    mockInvoke.mockResolvedValue({ data: { swapped: true }, error: null })
    render(<UpgradeCTA feature="Cartera" />)
    fireEvent.click(screen.getByRole('button', { name: /Actualizar plan/i }))

    await waitFor(() => expect(notify).toHaveBeenCalled())
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'success',
      title: expect.stringContaining('plan se actualizó'),
    }))
    expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }))
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1))
  })

  it('el botón vuelve a estado normal tras el swap (no redirige)', async () => {
    mockInvoke.mockResolvedValue({ data: { swapped: true }, error: null })
    render(<UpgradeCTA feature="X" />)
    const btn = screen.getByRole('button', { name: /Actualizar plan/i })
    fireEvent.click(btn)
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: /Actualizar plan/i })).toBeDefined())
  })
})
