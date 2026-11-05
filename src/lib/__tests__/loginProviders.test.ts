// Guideline 4.8 de App Review (Login Services): la app de iOS solo ofrece Google
// si también ofrece Sign in with Apple. Apple se activa por build con
// VITE_APPLE_SIGN_IN=true, en web y en la app de iOS; nunca en Android.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Se mockea @capacitor/core (no src/lib/platform) para recorrer el camino real:
// platform.ts → Capacitor.isNativePlatform() / Capacitor.getPlatform().
const capacitor = vi.hoisted(() => ({
  isNativePlatform: vi.fn<() => boolean>(),
  getPlatform: vi.fn<() => string>(),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: capacitor }))

import { appleSignInHabilitado, mostrarLoginConApple, mostrarLoginConGoogle } from '../loginProviders'

type Plataforma = 'web' | 'android' | 'ios'

function simularPlataforma(plataforma: Plataforma) {
  capacitor.isNativePlatform.mockReturnValue(plataforma !== 'web')
  capacitor.getPlatform.mockReturnValue(plataforma)
}

function botones(plataforma: Plataforma) {
  simularPlataforma(plataforma)
  return { google: mostrarLoginConGoogle(), apple: mostrarLoginConApple() }
}

beforeEach(() => {
  capacitor.isNativePlatform.mockReset()
  capacitor.getPlatform.mockReset()
  vi.stubEnv('VITE_APPLE_SIGN_IN', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('appleSignInHabilitado', () => {
  it('solo con VITE_APPLE_SIGN_IN=true o 1 (sin importar mayúsculas ni espacios)', () => {
    for (const v of ['true', 'TRUE', ' 1 ']) {
      vi.stubEnv('VITE_APPLE_SIGN_IN', v)
      expect(appleSignInHabilitado(), `valor ${JSON.stringify(v)}`).toBe(true)
    }
    for (const v of ['', 'false', '0', 'yes']) {
      vi.stubEnv('VITE_APPLE_SIGN_IN', v)
      expect(appleSignInHabilitado(), `valor ${JSON.stringify(v)}`).toBe(false)
    }
  })
})

describe('sin Sign in with Apple configurado', () => {
  it('web: Google sí, Apple no', () => {
    expect(botones('web')).toEqual({ google: true, apple: false })
  })

  it('app de Android: Google sí, Apple no (Google Play no tiene la regla 4.8)', () => {
    expect(botones('android')).toEqual({ google: true, apple: false })
  })

  it('app de iOS: ni Google ni Apple (sin Apple, Google violaría la 4.8)', () => {
    expect(botones('ios')).toEqual({ google: false, apple: false })
  })
})

describe('con Sign in with Apple configurado (VITE_APPLE_SIGN_IN=true)', () => {
  beforeEach(() => vi.stubEnv('VITE_APPLE_SIGN_IN', 'true'))

  it('web: Google y Apple', () => {
    expect(botones('web')).toEqual({ google: true, apple: true })
  })

  it('app de Android: solo Google (Apple no lo exige ni se ofrece fuera de iOS y web)', () => {
    expect(botones('android')).toEqual({ google: true, apple: false })
  })

  it('app de iOS: Google vuelve porque Apple ya cumple la 4.8', () => {
    expect(botones('ios')).toEqual({ google: true, apple: true })
  })

  // Capacitor reporta 'web' en cualquier navegador, también en Safari de un
  // iPhone: la regla es solo para el binario de la App Store.
  it('Safari en un iPhone es web, no la app', () => {
    capacitor.isNativePlatform.mockReturnValue(false)
    capacitor.getPlatform.mockReturnValue('web')
    expect(mostrarLoginConGoogle()).toBe(true)
    expect(mostrarLoginConApple()).toBe(true)
  })
})
