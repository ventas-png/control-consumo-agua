import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

// LandingPage dispara el warm-up de Supabase al montar; el módulo real exige
// las env vars VITE_SUPABASE_* que no existen en el entorno de test.
vi.mock('../../../lib/supabase', () => ({
  warmUpSupabase: vi.fn(),
}))

// Plataforma simulada vía @capacitor/core (el camino real: platform.ts →
// loginProviders.ts). Por defecto web; los tests de la app nativa la cambian.
const capacitor = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  getPlatform: vi.fn(() => 'web'),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: capacitor }))

function simularPlataforma(plataforma: 'web' | 'android' | 'ios') {
  capacitor.isNativePlatform.mockReturnValue(plataforma !== 'web')
  capacitor.getPlatform.mockReturnValue(plataforma)
}

import { LandingPage } from '../LandingPage'
import { checkA11y } from '../../../test/a11y'

beforeEach(() => {
  cleanup()
  // El test "switches copy to English" persiste lang=en en la URL — limpiar
  // para que los siguientes tests vuelvan al español por defecto.
  window.history.replaceState({}, '', '/')
  simularPlataforma('web')
  // Sign in with Apple apagado por defecto; los tests de Apple lo encienden.
  vi.stubEnv('VITE_APPLE_SIGN_IN', '')
})
afterEach(() => vi.unstubAllEnvs())

function setup(opts: { mfaChallenge?: { email: string } | null; initialAuthError?: string | null } = {}) {
  const onLogin = vi.fn(async () => null)
  const onLoginWithGoogle = vi.fn(async () => null)
  const onLoginWithApple = vi.fn(async () => null)
  const onForgotPassword = vi.fn()
  const onRegister = vi.fn()
  const onSignupCompany = vi.fn()
  const onVerifyMfa = vi.fn(async () => null)
  const onCancelMfa = vi.fn(async () => undefined)
  const utils = render(
    <LandingPage
      onLogin={onLogin}
      onLoginWithGoogle={onLoginWithGoogle}
      onLoginWithApple={onLoginWithApple}
      onForgotPassword={onForgotPassword}
      onRegister={onRegister}
      onSignupCompany={onSignupCompany}
      mfaChallenge={opts.mfaChallenge ?? null}
      onVerifyMfa={onVerifyMfa}
      onCancelMfa={onCancelMfa}
      initialAuthError={opts.initialAuthError ?? null}
    />,
  )
  return { onLogin, onLoginWithGoogle, onLoginWithApple, onForgotPassword, onRegister, onSignupCompany, onVerifyMfa, onCancelMfa, ...utils }
}

describe('LandingPage', () => {
  it('renders the AdministraTodo marketing landing', () => {
    setup()
    expect(screen.getAllByText('AdministraTodo').length).toBeGreaterThan(0)
    expect(screen.getByText('Administra agua,')).toBeTruthy()
    expect(screen.getByText('Comenzar configuración')).toBeTruthy()
  })

  it('opens the login modal and submits credentials to the real handler', async () => {
    const { onLogin } = setup()
    expect(screen.queryByText('Bienvenido de vuelta')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(screen.getByText('Bienvenido de vuelta')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('nombre@empresa.com'), { target: { value: 'admin@empresa.com' } })
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 's3cret' } })

    const submit = document.querySelector('.login-fields button[type="submit"]') as HTMLButtonElement
    fireEvent.click(submit)
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('admin@empresa.com', 's3cret'))
  })

  it('invokes the Google handler', async () => {
    const { onLoginWithGoogle } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuar con Google' }))
    await waitFor(() => expect(onLoginWithGoogle).toHaveBeenCalledTimes(1))
  })

  // Guideline 4.8 de App Review (Login Services): sin Sign in with Apple, la
  // app de iOS no puede ofrecer Google. Este modal es el login que ve la app.
  it('en la app de iOS el modal no ofrece Google ni el separador, y el correo sigue funcionando', async () => {
    simularPlataforma('ios')
    const { onLogin, onLoginWithGoogle, container } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(screen.getByText('Bienvenido de vuelta')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Continuar con Google' })).toBeNull()
    expect(screen.queryByText('o con tu correo')).toBeNull()

    fireEvent.change(screen.getByPlaceholderText('nombre@empresa.com'), { target: { value: 'admin@empresa.com' } })
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 's3cret' } })
    fireEvent.click(document.querySelector('.login-fields button[type="submit"]') as HTMLButtonElement)
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('admin@empresa.com', 's3cret'))
    expect(onLoginWithGoogle).not.toHaveBeenCalled()
    await checkA11y(container)
  })

  // Google Play no tiene esa regla: Android se comporta igual que la web.
  it('en la app de Android el modal sigue ofreciendo Google', async () => {
    simularPlataforma('android')
    const { onLoginWithGoogle } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(screen.getByText('o con tu correo')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continuar con Google' }))
    await waitFor(() => expect(onLoginWithGoogle).toHaveBeenCalledTimes(1))
  })

  describe('Sign in with Apple (VITE_APPLE_SIGN_IN=true)', () => {
    beforeEach(() => vi.stubEnv('VITE_APPLE_SIGN_IN', 'true'))

    it('sin la variable no hay botón de Apple en la web', () => {
      vi.stubEnv('VITE_APPLE_SIGN_IN', '')
      setup()
      fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
      expect(screen.queryByRole('button', { name: 'Continuar con Apple' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Continuar con Google' })).toBeTruthy()
    })

    it('web: muestra Apple encima de Google, el botón llama a su handler y pasa axe', async () => {
      const { onLoginWithApple, onLoginWithGoogle, container } = setup()
      fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
      const apple = screen.getByRole('button', { name: 'Continuar con Apple' })
      const google = screen.getByRole('button', { name: 'Continuar con Google' })
      expect(apple.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(apple.className).toBe('btn-apple')
      fireEvent.click(apple)
      await waitFor(() => expect(onLoginWithApple).toHaveBeenCalledTimes(1))
      expect(onLoginWithGoogle).not.toHaveBeenCalled()
      await checkA11y(container)
    })

    it('app de iOS: con Apple presente vuelve Google (la 4.8 queda cumplida)', () => {
      simularPlataforma('ios')
      setup()
      fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
      expect(screen.getByRole('button', { name: 'Continuar con Apple' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Continuar con Google' })).toBeTruthy()
      expect(screen.getByText('o con tu correo')).toBeTruthy()
    })

    it('app de Android: Google sí, Apple no', () => {
      simularPlataforma('android')
      setup()
      fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
      expect(screen.queryByRole('button', { name: 'Continuar con Apple' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Continuar con Google' })).toBeTruthy()
    })

    it('el error del login con Apple se muestra en el modal', async () => {
      const { onLoginWithApple } = setup()
      onLoginWithApple.mockResolvedValueOnce('Error al iniciar sesión con Apple' as unknown as null)
      fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
      fireEvent.click(screen.getByRole('button', { name: 'Continuar con Apple' }))
      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Error al iniciar sesión con Apple'))
    })
  })

  it('auto-opens the login modal showing the OAuth callback error', async () => {
    setup({ initialAuthError: 'No se pudo completar el inicio de sesión. Detalle: prueba' })
    // El useEffect abre el modal al detectar el error del redirect OAuth y el
    // LoginModal lo muestra como error inicial — antes el usuario volvía de
    // Google a la landing sin ningún mensaje.
    const heading = await screen.findByRole('heading', { name: 'Bienvenido de vuelta' })
    expect(heading).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('No se pudo completar el inicio de sesión')
  })

  it('switches copy to English via the language toggle', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(screen.getByText('Manage water,')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  })

  it('renders the MFA challenge view when an MFA challenge is active', async () => {
    const { onVerifyMfa } = setup({ mfaChallenge: { email: 'user@example.com' } })
    // useEffect en LandingPage abre el modal automáticamente al detectar el
    // challenge. aria-modal="true" oculta el resto, así que los queries van
    // directo al modal y vemos el segundo paso en lugar del email/password.
    const heading = await screen.findByRole('heading', { name: 'Verificación en dos pasos' })
    expect(heading).toBeTruthy()
    expect(screen.queryByText('Bienvenido de vuelta')).toBeNull()
    expect(screen.getByPlaceholderText('123456')).toBeTruthy()
    expect(screen.getByDisplayValue('user@example.com')).toBeTruthy()

    const codeInput = screen.getByPlaceholderText('123456') as HTMLInputElement
    fireEvent.change(codeInput, { target: { value: '123456' } })
    expect(codeInput.value).toBe('123456')

    const submit = screen.getByRole('button', { name: /Verificar e ingresar/i })
    fireEvent.click(submit)
    await waitFor(() => expect(onVerifyMfa).toHaveBeenCalledWith('123456'))
  })

  it('strips non-digits from the MFA code input', async () => {
    setup({ mfaChallenge: { email: 'user@example.com' } })
    const codeInput = await screen.findByPlaceholderText('123456') as HTMLInputElement
    fireEvent.change(codeInput, { target: { value: 'abc123def456' } })
    expect(codeInput.value).toBe('123456')
  })

  it('passes axe accessibility baseline (landing initial render)', async () => {
    const { container } = setup()
    await checkA11y(container)
  })

  it('passes axe accessibility baseline (login modal open)', async () => {
    const { container } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    await checkA11y(container)
  })

  it('passes axe accessibility baseline (MFA challenge view)', async () => {
    const { container } = setup({ mfaChallenge: { email: 'user@example.com' } })
    await checkA11y(container)
  })
})
