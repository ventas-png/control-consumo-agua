// Guideline 4.8 de App Review (Login Services): la app de iOS no ofrece Google
// mientras no exista Sign in with Apple. Web y Android no cambian.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Se mockea @capacitor/core (no src/lib/platform) para recorrer el camino real:
// platform.ts → Capacitor.isNativePlatform() / Capacitor.getPlatform().
const capacitor = vi.hoisted(() => ({
  isNativePlatform: vi.fn<() => boolean>(),
  getPlatform: vi.fn<() => string>(),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: capacitor }))

import { mostrarLoginConGoogle } from '../loginProviders'

function simularPlataforma(plataforma: 'web' | 'android' | 'ios') {
  capacitor.isNativePlatform.mockReturnValue(plataforma !== 'web')
  capacitor.getPlatform.mockReturnValue(plataforma)
}

beforeEach(() => {
  capacitor.isNativePlatform.mockReset()
  capacitor.getPlatform.mockReset()
})

describe('mostrarLoginConGoogle', () => {
  it('en la web se ofrece Google', () => {
    simularPlataforma('web')
    expect(mostrarLoginConGoogle()).toBe(true)
  })

  it('en la app de Android se ofrece Google (Google Play no tiene la regla 4.8)', () => {
    simularPlataforma('android')
    expect(mostrarLoginConGoogle()).toBe(true)
  })

  it('en la app de iOS NO se ofrece Google (guideline 4.8 sin Sign in with Apple)', () => {
    simularPlataforma('ios')
    expect(mostrarLoginConGoogle()).toBe(false)
  })

  // Capacitor reporta 'web' en cualquier navegador, también en Safari de un
  // iPhone: la regla es solo para el binario de la App Store.
  it('Safari en un iPhone es web, no la app: se ofrece Google', () => {
    capacitor.isNativePlatform.mockReturnValue(false)
    capacitor.getPlatform.mockReturnValue('web')
    expect(mostrarLoginConGoogle()).toBe(true)
  })
})
