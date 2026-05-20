import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { LandingPage } from '../LandingPage'

beforeEach(cleanup)

function setup() {
  const onLogin = vi.fn(async () => null)
  const onLoginWithGoogle = vi.fn(async () => null)
  const onForgotPassword = vi.fn()
  const onRegister = vi.fn()
  const utils = render(
    <LandingPage
      onLogin={onLogin}
      onLoginWithGoogle={onLoginWithGoogle}
      onForgotPassword={onForgotPassword}
      onRegister={onRegister}
    />,
  )
  return { onLogin, onLoginWithGoogle, onForgotPassword, onRegister, ...utils }
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
})
