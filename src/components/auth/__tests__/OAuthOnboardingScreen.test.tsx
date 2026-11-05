// Onboarding OAuth (Google / Apple → vincular con un cliente del padrón). Con
// Sign in with Apple pueden faltar dos datos que Google siempre trae: el nombre
// (Apple solo lo entrega la primera vez) y el correo real (alias
// @privaterelay.appleid.com con «Ocultar mi correo»). La pantalla los pide solo
// en esos casos y los manda en el payload; si no hacen falta, no van.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  completeOAuthOnboarding: vi.fn(),
  signOut: vi.fn(async () => undefined),
}))
vi.mock('../../../domain/auth/account', () => ({
  completeOAuthOnboarding: mocks.completeOAuthOnboarding,
  signOut: mocks.signOut,
}))

import OAuthOnboardingScreen from '../OAuthOnboardingScreen'

type Usuario = { id: string; email: string; full_name: string; provider: 'google' | 'apple' | 'oauth' }

function montar(oauthUser: Usuario) {
  const onSuccess = vi.fn()
  const onCancel = vi.fn()
  render(<OAuthOnboardingScreen oauthUser={oauthUser} onSuccess={onSuccess} onCancel={onCancel} />)
  return { onSuccess, onCancel }
}

const campoNombre = () => screen.queryByPlaceholderText('Nombre y apellidos')
const campoCorreo = () => screen.queryByPlaceholderText('nombre@correo.com')
const enviar = () => fireEvent.click(screen.getByRole('button', { name: 'Completar registro' }))

function llenarIdentidad() {
  fireEvent.change(screen.getByPlaceholderText('Número de DPI o CUI'), { target: { value: ' 1234567890101 ' } })
  const fecha = document.querySelector('input[type="date"]') as HTMLInputElement
  fireEvent.change(fecha, { target: { value: '1990-05-20' } })
}

beforeEach(() => {
  mocks.completeOAuthOnboarding.mockReset().mockResolvedValue({ data: { success: true }, error: null })
})
afterEach(() => cleanup())

describe('OAuthOnboardingScreen', () => {
  it('usuario de Google con nombre y correo: solo DPI y fecha, y el payload no lleva campos extra', async () => {
    const { onSuccess } = montar({ id: 'u1', email: 'ana@gmail.com', full_name: 'Ana García', provider: 'google' })
    expect(screen.getByText(/vincular tu cuenta de Google/)).toBeTruthy()
    expect(screen.getByText('Ana García')).toBeTruthy()
    expect(campoNombre()).toBeNull()
    expect(campoCorreo()).toBeNull()

    llenarIdentidad()
    enviar()
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(mocks.completeOAuthOnboarding).toHaveBeenCalledWith({ cui_dui: '1234567890101', fecha_nacimiento: '1990-05-20' })
  })

  it('usuario de Apple con nombre y correo real: igual que Google, sin campos extra', () => {
    montar({ id: 'u2', email: 'ana@icloud.com', full_name: 'Ana García', provider: 'apple' })
    expect(screen.getByText(/vincular tu cuenta de Apple/)).toBeTruthy()
    expect(campoNombre()).toBeNull()
    expect(campoCorreo()).toBeNull()
  })

  describe('usuario de Apple sin nombre y con correo oculto', () => {
    const usuario: Usuario = { id: 'u3', email: 'x9k2@privaterelay.appleid.com', full_name: '', provider: 'apple' }

    it('pide nombre y correo registrado, explica el alias y los exige', async () => {
      montar(usuario)
      expect(screen.getByText('Cuenta de Apple')).toBeTruthy()
      expect(screen.getByText(/Apple ocultó tu correo real/)).toBeTruthy()
      expect(campoNombre()).toBeTruthy()
      expect(campoCorreo()).toBeTruthy()

      llenarIdentidad()
      enviar()
      expect(await screen.findByText('Por favor complete todos los campos.')).toBeTruthy()
      expect(mocks.completeOAuthOnboarding).not.toHaveBeenCalled()
    })

    // 'ana@empresa' pasa la validación nativa de <input type="email"> (que en
    // el navegador corta antes los casos burdos) pero no la de la app, que exige
    // un dominio con punto: es la que protege el lookup del padrón.
    it('rechaza un correo registrado con formato inválido antes de llamar al servidor', async () => {
      montar(usuario)
      llenarIdentidad()
      fireEvent.change(campoNombre()!, { target: { value: 'Ana García' } })
      fireEvent.change(campoCorreo()!, { target: { value: 'ana@empresa' } })
      enviar()
      expect(await screen.findByText('El correo registrado no tiene un formato válido.')).toBeTruthy()
      expect(mocks.completeOAuthOnboarding).not.toHaveBeenCalled()
    })

    it('manda el nombre y el correo registrado (normalizado) junto con DPI y fecha', async () => {
      const { onSuccess } = montar(usuario)
      llenarIdentidad()
      fireEvent.change(campoNombre()!, { target: { value: '  Ana García ' } })
      fireEvent.change(campoCorreo()!, { target: { value: ' Ana@Empresa.com ' } })
      enviar()
      await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
      expect(mocks.completeOAuthOnboarding).toHaveBeenCalledWith({
        cui_dui: '1234567890101',
        fecha_nacimiento: '1990-05-20',
        full_name: 'Ana García',
        email_cliente: 'ana@empresa.com',
      })
    })
  })

  it('muestra el error que devuelve la edge function (p. ej. identidad no encontrada)', async () => {
    mocks.completeOAuthOnboarding.mockResolvedValueOnce({ data: { error: 'No se encontró un cliente con los datos proporcionados.' }, error: null })
    const { onSuccess } = montar({ id: 'u1', email: 'ana@gmail.com', full_name: 'Ana', provider: 'google' })
    llenarIdentidad()
    enviar()
    expect(await screen.findByText(/No se encontró un cliente/)).toBeTruthy()
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
