import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { CompanySuspendedBanner } from '../CompanySuspendedBanner'

const mockState: { company: { activa: boolean; suspended_reason: string | null } | null } = { company: null }

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const c: Record<string, unknown> = {}
      const pass = () => c
      c.select = pass
      c.eq = pass
      c.maybeSingle = () => Promise.resolve({ data: mockState.company, error: null })
      return c
    },
  },
}))

beforeEach(() => {
  cleanup()
  mockState.company = null
})

describe('CompanySuspendedBanner', () => {
  it('no renderiza si companyId es null', () => {
    const { container } = render(<CompanySuspendedBanner companyId={null} />)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('no renderiza si la empresa no es visible', async () => {
    mockState.company = null
    const { container } = render(<CompanySuspendedBanner companyId="c1" />)
    await waitFor(() => {/* settle */}, { timeout: 100 }).catch(() => {})
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('no renderiza si la empresa está activa', async () => {
    mockState.company = { activa: true, suspended_reason: null }
    const { container } = render(<CompanySuspendedBanner companyId="c1" />)
    await waitFor(() => {/* settle */}, { timeout: 100 }).catch(() => {})
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('renderiza el aviso cuando la empresa está suspendida', async () => {
    mockState.company = { activa: false, suspended_reason: null }
    render(<CompanySuspendedBanner companyId="c1" />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByRole('alert').textContent).toContain('suspendida')
    expect(screen.getByRole('alert').textContent).toContain('solo lectura')
  })

  it('incluye el motivo cuando existe', async () => {
    mockState.company = { activa: false, suspended_reason: 'falta de pago' }
    render(<CompanySuspendedBanner companyId="c1" />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByRole('alert').textContent).toContain('falta de pago')
  })
})
