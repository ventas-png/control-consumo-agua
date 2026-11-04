// LoginScreen: el botón «Continuar con Google» y su separador solo se muestran
// donde se ofrece Google. En la app de iOS no (guideline 4.8 de App Review,
// ver src/lib/loginProviders.ts); en web y Android sí, como siempre.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

// Se mockea @capacitor/core para que la decisión pase por el camino real
// (platform.ts → loginProviders.ts), no por un mock del helper.
const capacitor = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  getPlatform: vi.fn(() => 'web'),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: capacitor }))

// La detección de SSO consulta Supabase al teclear el correo; aquí no hay backend.
vi.mock('../../../lib/sso', () => ({
  detectSsoForEmail: vi.fn(async () => ({ available: false })),
  signInWithSso: vi.fn(async () => ({ error: 'sin SSO' })),
}))

import { LoginScreen } from '../LoginScreen'

function simularPlataforma(plataforma: 'web' | 'android' | 'ios') {
  capacitor.isNativePlatform.mockReturnValue(plataforma !== 'web')
  capacitor.getPlatform.mockReturnValue(plataforma)
}

function montar() {
  const onLogin = vi.fn(async () => null)
  const onLoginWithGoogle = vi.fn(async () => null)
  render(
    <LoginScreen
      onLogin={onLogin}
      onLoginWithGoogle={onLoginWithGoogle}
      onForgotPassword={vi.fn()}
      onRegister={vi.fn()}
    />,
  )
  return { onLogin, onLoginWithGoogle }
}

const botonGoogle = () => screen.queryByRole('button', { name: 'Continuar con Google' })
const separador = () => screen.queryByText('o con tu correo')

beforeEach(() => simularPlataforma('web'))
afterEach(() => cleanup())

describe('LoginScreen · login con Google por plataforma', () => {
  it('web: muestra el botón de Google y el separador, y el botón llama al handler', async () => {
    const { onLoginWithGoogle } = montar()
    expect(botonGoogle()).toBeTruthy()
    expect(separador()).toBeTruthy()
    fireEvent.click(botonGoogle()!)
    await waitFor(() => expect(onLoginWithGoogle).toHaveBeenCalledTimes(1))
  })

  it('app de Android: muestra el botón de Google y el separador', async () => {
    simularPlataforma('android')
    const { onLoginWithGoogle } = montar()
    expect(botonGoogle()).toBeTruthy()
    expect(separador()).toBeTruthy()
    fireEvent.click(botonGoogle()!)
    await waitFor(() => expect(onLoginWithGoogle).toHaveBeenCalledTimes(1))
  })

  it('app de iOS: no muestra el botón de Google ni el separador (guideline 4.8)', () => {
    simularPlataforma('ios')
    montar()
    expect(botonGoogle()).toBeNull()
    expect(separador()).toBeNull()
  })

  it('app de iOS: el login con correo y contraseña sigue intacto', async () => {
    simularPlataforma('ios')
    const { onLogin, onLoginWithGoogle } = montar()
    fireEvent.change(screen.getByPlaceholderText('Correo electrónico'), { target: { value: 'admin@empresa.com' } })
    fireEvent.change(screen.getByPlaceholderText('Contraseña'), { target: { value: 's3cret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar Sesión' }))
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('admin@empresa.com', 's3cret'))
    expect(onLoginWithGoogle).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Registrarse →' })).toBeTruthy()
  })
})
