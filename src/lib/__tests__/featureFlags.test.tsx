import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { FeatureFlagsProvider, FeatureGate, useFeatureFlags } from '../featureFlags'

// Mock supabase client
const mockSelect = vi.fn()
vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: mockSelect,
    })),
  },
}))

beforeEach(() => {
  cleanup()
  mockSelect.mockReset()
})

function FlagsRender() {
  const { flags, has, planCode, planName, loading } = useFeatureFlags()
  if (loading) return <div>Loading…</div>
  return (
    <div>
      <div data-testid="plan">{planCode}</div>
      <div data-testid="plan-name">{planName}</div>
      <div data-testid="codes">{Array.from(flags).sort().join(',')}</div>
      <div data-testid="has-asambleas">{String(has('asambleas_digitales'))}</div>
      <div data-testid="has-api">{String(has('api_access'))}</div>
    </div>
  )
}

describe('featureFlags — FeatureFlagsProvider', () => {
  it('carga features y plan code de la vista my_feature_flags', async () => {
    mockSelect.mockResolvedValue({
      data: [
        { feature_code: 'asambleas_digitales', plan_code: 'bundle', plan_name: 'Bundle Completo' },
        { feature_code: 'transparencia_financiera', plan_code: 'bundle', plan_name: 'Bundle Completo' },
        { feature_code: 'cobranza_judicial', plan_code: 'bundle', plan_name: 'Bundle Completo' },
      ],
      error: null,
    })
    render(
      <FeatureFlagsProvider>
        <FlagsRender />
      </FeatureFlagsProvider>,
    )
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
    expect(screen.getByTestId('plan').textContent).toBe('bundle')
    expect(screen.getByTestId('plan-name').textContent).toBe('Bundle Completo')
    expect(screen.getByTestId('codes').textContent).toBe('asambleas_digitales,cobranza_judicial,transparencia_financiera')
    expect(screen.getByTestId('has-asambleas').textContent).toBe('true')
    expect(screen.getByTestId('has-api').textContent).toBe('false')
  })

  it('descarta feature codes desconocidos (defensivo)', async () => {
    mockSelect.mockResolvedValue({
      data: [
        { feature_code: 'asambleas_digitales', plan_code: 'condominios_only', plan_name: 'Solo Condominios' },
        { feature_code: 'feature_desconocido_futuro', plan_code: 'condominios_only', plan_name: 'Solo Condominios' },
      ],
      error: null,
    })
    render(
      <FeatureFlagsProvider>
        <FlagsRender />
      </FeatureFlagsProvider>,
    )
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
    // Solo asambleas_digitales pasó (feature_desconocido_futuro fue descartado).
    expect(screen.getByTestId('codes').textContent).toBe('asambleas_digitales')
  })

  it('fallback vacio cuando supabase falla', async () => {
    mockSelect.mockResolvedValue({ data: null, error: { message: 'RLS denied' } })
    render(
      <FeatureFlagsProvider>
        <FlagsRender />
      </FeatureFlagsProvider>,
    )
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
    expect(screen.getByTestId('plan').textContent).toBe('')
    expect(screen.getByTestId('codes').textContent).toBe('')
    expect(screen.getByTestId('has-asambleas').textContent).toBe('false')
  })
})

describe('featureFlags — FeatureGate', () => {
  it('renderiza children cuando la feature está incluida', async () => {
    mockSelect.mockResolvedValue({
      data: [{ feature_code: 'asambleas_digitales', plan_code: 'bundle', plan_name: 'Bundle' }],
      error: null,
    })
    render(
      <FeatureFlagsProvider>
        <FeatureGate feature="asambleas_digitales" fallback={<div>UPGRADE</div>}>
          <div>FEATURE_CONTENT</div>
        </FeatureGate>
      </FeatureFlagsProvider>,
    )
    await waitFor(() => expect(screen.queryByText('FEATURE_CONTENT')).toBeDefined())
    expect(screen.queryByText('UPGRADE')).toBeNull()
  })

  it('renderiza fallback cuando la feature NO está incluida', async () => {
    mockSelect.mockResolvedValue({
      data: [{ feature_code: 'cobranza_judicial', plan_code: 'agua_only', plan_name: 'Solo Agua' }],
      error: null,
    })
    render(
      <FeatureFlagsProvider>
        <FeatureGate feature="asambleas_digitales" fallback={<div>UPGRADE</div>}>
          <div>FEATURE_CONTENT</div>
        </FeatureGate>
      </FeatureFlagsProvider>,
    )
    await waitFor(() => expect(screen.queryByText('UPGRADE')).toBeDefined())
    expect(screen.queryByText('FEATURE_CONTENT')).toBeNull()
  })

  it('renderiza loadingFallback mientras se cargan las features', () => {
    // Promise sin resolver — el provider se queda en loading=true.
    mockSelect.mockReturnValue(new Promise(() => {}))
    render(
      <FeatureFlagsProvider>
        <FeatureGate
          feature="asambleas_digitales"
          fallback={<div>UPGRADE</div>}
          loadingFallback={<div>LOADING_FLAGS</div>}
        >
          <div>FEATURE_CONTENT</div>
        </FeatureGate>
      </FeatureFlagsProvider>,
    )
    expect(screen.getByText('LOADING_FLAGS')).toBeDefined()
    expect(screen.queryByText('FEATURE_CONTENT')).toBeNull()
  })
})

describe('featureFlags — useFeatureFlags fuera de Provider', () => {
  it('devuelve valores vacios sin lanzar error', () => {
    render(<FlagsRender />)
    expect(screen.getByTestId('codes').textContent).toBe('')
    expect(screen.getByTestId('plan').textContent).toBe('')
    expect(screen.getByTestId('has-asambleas').textContent).toBe('false')
  })
})
