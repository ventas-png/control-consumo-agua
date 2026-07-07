import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

// LandingPage dispara el warm-up de Supabase al montar; el módulo real exige
// las env vars VITE_SUPABASE_* que no existen en el entorno de test.
vi.mock('../../../lib/supabase', () => ({
  warmUpSupabase: vi.fn(),
}))

import { LandingPage } from '../LandingPage'
import { checkA11y } from '../../../test/a11y'

beforeEach(() => {
  cleanup()
  // El test "switches copy to English" persiste lang=en en la URL — limpiar
  // para que los siguientes tests vuelvan al español por defecto.
  window.history.replaceState({}, '', '/')
})

function setup(opts: { mfaChallenge?: { email: string } | null } = {}) {
  const onLogin = vi.fn(async () => null)
  const onLoginWithGoogle = vi.fn(async () => null)
  const onForgotPassword = vi.fn()
  const onRegister = vi.fn()
  const onSignupCompany = vi.fn()
  const onVerifyMfa = vi.fn(async () => null)
  const onCancelMfa = vi.fn(async () => undefined)
  const utils = render(
    <LandingPage
      onLogin={onLogin}
      onLoginWithGoogle={onLoginWithGoogle}
      onForgotPassword={onForgotPassword}
      onRegister={onRegister}
      onSignupCompany={onSignupCompany}
      mfaChallenge={opts.mfaChallenge ?? null}
      onVerifyMfa={onVerifyMfa}
      onCancelMfa={onCancelMfa}
    />,
  )
  return { onLogin, onLoginWithGoogle, onForgotPassword, onRegister, onSignupCompany, onVerifyMfa, onCancelMfa, ...utils }
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
