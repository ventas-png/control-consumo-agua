import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { DialogProvider } from '../Dialog'
import { PastDueBanner } from '../PastDueBanner'

const mockState: { sub: { status: string; past_due_since?: string | null } | null } = { sub: null }

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

function daysAgo(d: number): string {
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString()
}

beforeEach(() => {
  cleanup()
  mockState.sub = null
})

describe('PastDueBanner', () => {
  it('no renderiza si companyId es null', () => {
    const { container } = render(<DialogProvider><PastDueBanner companyId={null} /></DialogProvider>)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('no renderiza si no hay subscription', async () => {
    mockState.sub = null
    const { container } = render(<DialogProvider><PastDueBanner companyId="c1" /></DialogProvider>)
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeNull())
  })

  it('no renderiza si status != past_due', async () => {
    mockState.sub = { status: 'active', past_due_since: null }
    const { container } = render(<DialogProvider><PastDueBanner companyId="c1" /></DialogProvider>)
    await waitFor(() => {/* settle */}, { timeout: 100 }).catch(() => {})
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('renderiza con días de gracia restantes cuando el pago falló hace 5 días', async () => {
    mockState.sub = { status: 'past_due', past_due_since: daysAgo(5) }
    render(<DialogProvider><PastDueBanner companyId="c1" /></DialogProvider>)
    await waitFor(() => expect(screen.getByText(/rechazado/)).toBeTruthy())
    // 14 - 5 = 9 días restantes
    expect(screen.getByText(/9 días/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Actualizar método de pago' })).toBeTruthy()
  })

  it('muestra modo solo lectura cuando la gracia ya venció (20 días)', async () => {
    mockState.sub = { status: 'past_due', past_due_since: daysAgo(20) }
    render(<DialogProvider><PastDueBanner companyId="c1" /></DialogProvider>)
    await waitFor(() => expect(screen.getByText(/solo lectura/)).toBeTruthy())
  })

  it('sin past_due_since (legacy) muestra mensaje lenient sin cuenta atrás', async () => {
    mockState.sub = { status: 'past_due', past_due_since: null }
    render(<DialogProvider><PastDueBanner companyId="c1" /></DialogProvider>)
    await waitFor(() => expect(screen.getByText(/evitar la suspensión/)).toBeTruthy())
    expect(screen.queryByText(/días/)).toBeNull()
  })

  it('no es descartable: no hay botón "Después"', async () => {
    mockState.sub = { status: 'past_due', past_due_since: daysAgo(3) }
    render(<DialogProvider><PastDueBanner companyId="c1" /></DialogProvider>)
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: /Después|Ocultar/ })).toBeNull()
  })
})
