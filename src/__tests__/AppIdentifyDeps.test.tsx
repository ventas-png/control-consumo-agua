// Regresión react-hooks/exhaustive-deps (App.tsx:200).
//
// El efecto que identifica al usuario ante analytics y Sentry lee `user_id`,
// `company_id` Y `role`, pero sus dependencias eran solo `[currentUser?.user_id]`.
// Un cambio de rol (o de empresa) sin cambio de usuario dejaba TODOS los eventos
// posteriores etiquetados con el rol anterior — las super-propiedades de PostHog
// y el contexto de Sentry viajan en cada evento, así que el dato viejo contamina
// el análisis y la depuración hasta el siguiente login.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { UserSession } from '../types'

// Stub encadenable: cualquier `.select().eq().order()...` devuelve el mismo
// proxy, y al esperarlo (thenable) resuelve una respuesta vacía. Aquí no se
// prueba ninguna consulta, solo el efecto de identificación.
vi.mock('../lib/supabase', () => {
  const VACIO = { data: [], error: null, count: 0 }
  const cadena: unknown = new Proxy(function () {} as unknown as object, {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => unknown) => Promise.resolve(VACIO).then(res)
      return () => cadena
    },
    apply: () => cadena,
  })
  const cliente = {
    from: () => cadena,
    rpc: () => cadena,
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: vi.fn(),
    auth: { getSession: async () => ({ data: { session: null } }) },
  }
  return {
    supabase: cliente,
    db: cliente,
    warmUpSupabase: vi.fn(),
    getOAuthCallbackError: () => null,
  }
})

const a = vi.hoisted(() => ({
  identify: vi.fn(),
  registerSuperProperties: vi.fn(),
  resetAnalytics: vi.fn(),
  setMonitoringUser: vi.fn(),
}))

vi.mock('../lib/analytics', () => ({
  identify: a.identify,
  registerSuperProperties: a.registerSuperProperties,
  resetAnalytics: a.resetAnalytics,
  track: vi.fn(),
  initAnalytics: vi.fn(),
}))
vi.mock('../lib/monitoring', () => ({
  setMonitoringUser: a.setMonitoringUser,
  initMonitoring: vi.fn(),
  captureException: vi.fn(),
}))

let sesion: UserSession | null = null

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    currentUser: sesion, loading: false, isPasswordRecovery: false,
    needsOnboarding: false, pendingOAuthUser: null, oauthError: null,
    completeOnboarding: vi.fn(), login: vi.fn(), loginWithGoogle: vi.fn(),
    logout: vi.fn(), updateProfile: vi.fn(), mfaChallenge: null,
    verifyMfaChallenge: vi.fn(), cancelMfaChallenge: vi.fn(),
  }),
}))

function usuario(over: Partial<UserSession> = {}): UserSession {
  return {
    user_id: 'u-1', company_id: 'emp-1', role: 'lecturista',
    name: 'Ana', email: 'ana@example.com', login_time: '2026-08-18T10:00:00.000Z',
    ...over,
  } as unknown as UserSession
}

async function renderApp() {
  const { default: App } = await import('../App')
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}><App /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  sesion = usuario()
  Object.values(a).forEach(m => m.mockClear())
})

afterEach(() => { vi.resetModules() })

describe('App — identificación de usuario en analytics/monitoring', () => {
  it('identifica al montar con user_id, empresa y rol', async () => {
    await act(async () => { await renderApp() })

    expect(a.identify).toHaveBeenCalledWith('u-1', { company_id: 'emp-1', role: 'lecturista' })
    expect(a.registerSuperProperties).toHaveBeenCalledWith({ company_id: 'emp-1', role: 'lecturista' })
    expect(a.setMonitoringUser).toHaveBeenCalledWith({ id: 'u-1', companyId: 'emp-1', role: 'lecturista' })
  })

  it('RE-identifica cuando cambia el ROL del mismo usuario', async () => {
    const { rerender } = await act(async () => await renderApp())
    a.identify.mockClear(); a.registerSuperProperties.mockClear(); a.setMonitoringUser.mockClear()

    // Mismo user_id, rol nuevo: antes esto NO re-identificaba.
    sesion = usuario({ role: 'admin' })
    const { default: App } = await import('../App')
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await act(async () => {
      rerender(
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={['/']}><App /></MemoryRouter>
        </QueryClientProvider>,
      )
    })

    expect(a.identify).toHaveBeenCalledWith('u-1', { company_id: 'emp-1', role: 'admin' })
    expect(a.registerSuperProperties).toHaveBeenCalledWith({ company_id: 'emp-1', role: 'admin' })
    expect(a.setMonitoringUser).toHaveBeenCalledWith({ id: 'u-1', companyId: 'emp-1', role: 'admin' })
  })

  it('no identifica cuando no hay sesión', async () => {
    sesion = null
    await act(async () => { await renderApp() })

    expect(a.identify).not.toHaveBeenCalled()
    expect(a.setMonitoringUser).not.toHaveBeenCalled()
  })
})
