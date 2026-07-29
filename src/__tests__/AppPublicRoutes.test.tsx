import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// ════════════════════════════════════════════════════════════════════════════
// App — rutas públicas vs. shell autenticado (auditoría 2026-07-28, PR-33).
//
// `App` estaba partido en un solo componente: los tres `return` de las rutas
// públicas al principio, y los ~31 hooks DESPUÉS. Eso viola las Rules of Hooks
// (0 hooks en esas rutas, 31 en el resto) y basta un `navigate()` desde una de
// ellas para que React lance "Rendered more hooks than during the previous
// render".
//
// El arreglo separa `App` (sin hooks, solo decide ruta pública) de `AppShell`
// (todos los hooks). Estos tests fijan LA INVARIANTE que hace que el bug no
// pueda volver: en una ruta pública, el shell NO se monta — y la señal de que no
// se monta es que `useAuth` no llega a llamarse nunca.
//
// `App.tsx` no tenía ningún test antes de esto.
// ════════════════════════════════════════════════════════════════════════════

// `lib/supabase` LANZA al importarse si faltan las env vars, y App lo arrastra
// transitivamente (TrialExpirationBanner → domain/shared/queries). Se stubea
// igual que en el resto de tests de lógica pura del repo: aquí no se toca red.
vi.mock('../lib/supabase', () => {
  const noDb = () => { throw new Error('no debe usarse el cliente en este test') }
  return {
    supabase: { from: noDb, rpc: noDb, auth: { getSession: noDb } },
    db: { from: noDb },
    warmUpSupabase: vi.fn(),
    getOAuthCallbackError: () => null,
  }
})

const useAuthSpy = vi.fn()

vi.mock('../hooks/useAuth', () => ({
  useAuth: (...args: unknown[]) => {
    useAuthSpy(...args)
    return {
      currentUser: null, loading: false, isPasswordRecovery: false,
      needsOnboarding: false, pendingOAuthUser: null, oauthError: null,
      completeOnboarding: vi.fn(), login: vi.fn(), loginWithGoogle: vi.fn(),
      logout: vi.fn(), updateProfile: vi.fn(), mfaChallenge: null,
      verifyMfaChallenge: vi.fn(), cancelMfaChallenge: vi.fn(),
    }
  },
}))

// Las páginas públicas se sustituyen por marcadores: aquí interesa QUÉ RAMA se
// toma, no su contenido (cada página tiene sus propios tests). App las carga vía
// `lazy()` desde el barrel de lazySections, así que se mockea ese módulo.
vi.mock('../components/app/lazySections', () => ({
  LegalPage: ({ doc, lang }: { doc: string; lang: string }) => (
    <div data-testid="legal">{doc}:{lang}</div>
  ),
  AcceptInvitationPage: () => <div data-testid="invitacion" />,
  CondominiosClientPortal: () => null,
  CustomerPortal: () => null,
  LandingPage: () => null,
  OAuthOnboardingScreen: () => null,
  PasswordResetModal: () => null,
  PasswordResetPage: () => null,
}))

function setPath(pathname: string, search = '') {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname, search },
    writable: true,
    configurable: true,
  })
}

const originalLocation = window.location

beforeEach(() => {
  useAuthSpy.mockClear()
})

afterEach(() => {
  Object.defineProperty(window, 'location', {
    value: originalLocation, writable: true, configurable: true,
  })
  vi.resetModules()
})

describe('App — rutas públicas (sessionless)', () => {
  it('/politica-privacidad renderiza la página legal SIN montar el shell', async () => {
    setPath('/politica-privacidad')
    const { default: App } = await import('../App')
    render(<App />)

    expect((await screen.findByTestId('legal')).textContent).toBe('privacy:es')
    // La invariante: si el shell se hubiera montado, useAuth se habría llamado.
    expect(useAuthSpy).not.toHaveBeenCalled()
  })

  it('respeta ?lang=en en la suite legal', async () => {
    setPath('/terminos-servicio', '?lang=en')
    const { default: App } = await import('../App')
    render(<App />)

    expect((await screen.findByTestId('legal')).textContent).toBe('tos:en')
    expect(useAuthSpy).not.toHaveBeenCalled()
  })

  it('/acuerdo-dpa-cookies mapea al doc dpa', async () => {
    setPath('/acuerdo-dpa-cookies')
    const { default: App } = await import('../App')
    render(<App />)

    expect((await screen.findByTestId('legal')).textContent).toBe('dpa:es')
  })

  it('/aceptar-invitacion renderiza el alta por invitación SIN montar el shell', async () => {
    setPath('/aceptar-invitacion')
    const { default: App } = await import('../App')
    render(<App />)

    expect(await screen.findByTestId('invitacion')).toBeTruthy()
    expect(useAuthSpy).not.toHaveBeenCalled()
  })

  it('una ruta legal desconocida NO toma la rama pública', async () => {
    // Regresión: el mapa de rutas legales debe ser exacto, no un prefijo.
    // Aquí App delega en AppShell, que usa el router — de ahí el MemoryRouter.
    setPath('/politica-privacidad-falsa')
    const { default: App } = await import('../App')
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/politica-privacidad-falsa']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.queryByTestId('legal')).toBeNull()
    // Y la contraparte de la invariante: fuera de las rutas públicas el shell SÍ
    // se monta, así que useAuth se llama.
    expect(useAuthSpy).toHaveBeenCalled()
  })
})
