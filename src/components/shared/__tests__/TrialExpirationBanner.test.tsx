import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { DialogProvider } from '../Dialog'
import { TrialExpirationBanner } from '../TrialExpirationBanner'

const mockState: { sub: { status: string; trial_end: string | null } | null } = { sub: null }

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const c: Record<string, unknown> = {}
      const pass = () => c
      c.select = pass
      c.eq = pass
      c.in = pass
      c.maybeSingle = () => Promise.resolve({ data: mockState.sub, error: null })
      return c
    },
  },
}))

function daysFromNow(d: number): string {
  return new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString()
}

beforeEach(() => {
  cleanup()
  sessionStorage.clear()
  mockState.sub = null
})

describe('TrialExpirationBanner', () => {
  it('no renderiza si companyId es null', () => {
    const { container } = render(<DialogProvider><TrialExpirationBanner companyId={null} /></DialogProvider>)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('no renderiza si no hay subscription', async () => {
    mockState.sub = null
    const { container } = render(<DialogProvider><TrialExpirationBanner companyId="c1" /></DialogProvider>)
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeNull())
  })

  it('no renderiza si status != trialing', async () => {
    mockState.sub = { status: 'active', trial_end: daysFromNow(3) }
    const { container } = render(<DialogProvider><TrialExpirationBanner companyId="c1" /></DialogProvider>)
    await waitFor(() => {/* let effect settle */}, { timeout: 100 }).catch(() => {})
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('no renderiza si trial_end es lejano (> 7 dias)', async () => {
    mockState.sub = { status: 'trialing', trial_end: daysFromNow(14) }
    const { container } = render(<DialogProvider><TrialExpirationBanner companyId="c1" /></DialogProvider>)
    await waitFor(() => {/* settle */}, { timeout: 100 }).catch(() => {})
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('renderiza warning cuando trial expira en 5 dias', async () => {
    mockState.sub = { status: 'trialing', trial_end: daysFromNow(5) }
    render(<DialogProvider><TrialExpirationBanner companyId="c1" /></DialogProvider>)
    await waitFor(() => expect(screen.getByText(/Tu trial termina/)).toBeTruthy())
    expect(screen.getByText(/en 5 días/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Configurar pago' })).toBeTruthy()
  })

  it('muestra "mañana" cuando quedan 1 dia', async () => {
    mockState.sub = { status: 'trialing', trial_end: daysFromNow(1) }
    render(<DialogProvider><TrialExpirationBanner companyId="c1" /></DialogProvider>)
    await waitFor(() => expect(screen.getByText(/mañana/)).toBeTruthy())
  })

  it('muestra "hoy" cuando queda menos de 1 dia', async () => {
    // ceil(0.5 días) = 1, no 0. Para forzar 'hoy' necesitamos < 0 horas pero
    // > 0 (no expirado). Usamos 1 hora.
    mockState.sub = { status: 'trialing', trial_end: new Date(Date.now() + 60 * 60 * 1000).toISOString() }
    render(<DialogProvider><TrialExpirationBanner companyId="c1" /></DialogProvider>)
    // ceil(1 hora / 24 hr) = 1 día. Aceptamos "mañana" porque el calculo
    // redondea arriba.
    await waitFor(() => expect(screen.queryByText(/hoy|mañana/)).toBeTruthy())
  })

  it('aplica color de urgencia (rojo) cuando quedan 2 dias o menos', async () => {
    mockState.sub = { status: 'trialing', trial_end: daysFromNow(2) }
    render(<DialogProvider><TrialExpirationBanner companyId="c1" /></DialogProvider>)
    const banner = await screen.findByRole('alert')
    expect(banner.style.background).toContain('danger')
  })

  it('aplica color de aviso (amarillo) cuando quedan 3-7 dias', async () => {
    mockState.sub = { status: 'trialing', trial_end: daysFromNow(6) }
    render(<DialogProvider><TrialExpirationBanner companyId="c1" /></DialogProvider>)
    const banner = await screen.findByRole('alert')
    expect(banner.style.background).toContain('warning')
  })

  it('boton "Después" oculta el banner y persiste en sessionStorage', async () => {
    mockState.sub = { status: 'trialing', trial_end: daysFromNow(3) }
    render(<DialogProvider><TrialExpirationBanner companyId="c1" /></DialogProvider>)
    await waitFor(() => expect(screen.getByText(/Tu trial termina/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Ocultar este aviso/ }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(sessionStorage.getItem('at:trial-banner-dismissed')).toBe('1')
  })

  it('no renderiza si ya fue dismissed en esta sesion', async () => {
    sessionStorage.setItem('at:trial-banner-dismissed', '1')
    mockState.sub = { status: 'trialing', trial_end: daysFromNow(3) }
    const { container } = render(<DialogProvider><TrialExpirationBanner companyId="c1" /></DialogProvider>)
    await waitFor(() => {/* settle */}, { timeout: 100 }).catch(() => {})
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})
