import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { DialogProvider } from '../../shared/Dialog'
import { OPEN_BILLING_EVENT } from '../../shared/promptUpgrade'
import { PlanUsageCard } from '../PlanUsageCard'

// Mock usePlanLimits para controlar el estado del hook en cada test.
// El hook real hace RPCs a Supabase; no queremos red en unit tests.
vi.mock('../../../hooks/usePlanLimits', () => ({
  usePlanLimits: vi.fn(),
}))
import { usePlanLimits } from '../../../hooks/usePlanLimits'
const mockedHook = vi.mocked(usePlanLimits)

beforeEach(() => {
  cleanup()
  sessionStorage.clear()
  mockedHook.mockReset()
})

function withDefaults(over: Partial<ReturnType<typeof usePlanLimits>>) {
  mockedHook.mockReturnValue({
    max_projects: 5, max_units: 100,
    projects_count: 1, units_count: 10,
    loading: false, error: null,
    refresh: () => {},
    ...over,
  })
}

describe('PlanUsageCard', () => {
  it('no renderiza si companyId es null', () => {
    withDefaults({})
    const { container } = render(<DialogProvider><PlanUsageCard companyId={null} /></DialogProvider>)
    // Solo queda el container del DialogProvider, sin la card
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
  })

  it('renderiza estado loading', () => {
    withDefaults({ loading: true })
    render(<DialogProvider><PlanUsageCard companyId="c1" /></DialogProvider>)
    expect(screen.getByText('Cargando…')).toBeTruthy()
  })

  it('renderiza dos barras de progresso con %', () => {
    withDefaults({ projects_count: 2, max_projects: 5, units_count: 47, max_units: 100 })
    render(<DialogProvider><PlanUsageCard companyId="c1" /></DialogProvider>)
    expect(screen.getByText('Proyectos')).toBeTruthy()
    expect(screen.getByText('Unidades')).toBeTruthy()
    expect(screen.getByText(/2 \/ 5/)).toBeTruthy()
    expect(screen.getByText(/47 \/ 100/)).toBeTruthy()
    // 2 progressbars con roles ARIA
    expect(screen.getAllByRole('progressbar')).toHaveLength(2)
  })

  it('muestra (ilimitado) cuando max es null', () => {
    withDefaults({ max_projects: null, max_units: 100 })
    render(<DialogProvider><PlanUsageCard companyId="c1" /></DialogProvider>)
    expect(screen.getByText(/\(ilimitado\)/)).toBeTruthy()
    // Solo 1 progressbar (la de unidades; proyectos es ilimitado)
    expect(screen.getAllByRole('progressbar')).toHaveLength(1)
  })

  it('muestra CTA "Mejorar plan" cuando current >= max', async () => {
    withDefaults({ projects_count: 5, max_projects: 5, units_count: 10, max_units: 100 })
    render(<DialogProvider><PlanUsageCard companyId="c1" /></DialogProvider>)
    expect(screen.getByRole('button', { name: 'Mejorar plan' })).toBeTruthy()
  })

  it('NO muestra CTA cuando current < max', () => {
    withDefaults({ projects_count: 3, max_projects: 5, units_count: 10, max_units: 100 })
    render(<DialogProvider><PlanUsageCard companyId="c1" /></DialogProvider>)
    expect(screen.queryByRole('button', { name: 'Mejorar plan' })).toBeNull()
  })

  it('CTA "Mejorar plan" dispara promptUpgrade flow', async () => {
    withDefaults({ projects_count: 5, max_projects: 5, units_count: 10, max_units: 100 })
    const handler = vi.fn()
    window.addEventListener(OPEN_BILLING_EVENT, handler)
    render(<DialogProvider><PlanUsageCard companyId="c1" /></DialogProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Mejorar plan' }))
    await waitFor(() => expect(screen.getByText('Límite del plan alcanzado')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Ver planes' }))
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1))
    window.removeEventListener(OPEN_BILLING_EVENT, handler)
  })

  it('error en el hook resulta en card oculta (no rompe la UI)', () => {
    withDefaults({ error: 'RPC failed' })
    const { container } = render(<DialogProvider><PlanUsageCard companyId="c1" /></DialogProvider>)
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
  })
})
