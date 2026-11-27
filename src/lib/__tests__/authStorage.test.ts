// Dónde se guarda la sesión de Supabase: solo la app nativa y la web instalada
// como app la conservan al cerrarse. Una pestaña del navegador nunca: es la
// decisión de seguridad original de la web (ver src/lib/authStorage.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Se mockea @capacitor/core (no src/lib/platform) para recorrer el camino real.
const capacitor = vi.hoisted(() => ({
  isNativePlatform: vi.fn<() => boolean>(),
  getPlatform: vi.fn<() => string>(),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: capacitor }))

import { almacenDeSesion, sesionPersistente } from '../authStorage'

/** jsdom no trae matchMedia. `modo` es el display-mode que reporta el navegador. */
function simularDisplayMode(modo: 'browser' | 'standalone' | 'fullscreen') {
  window.matchMedia = vi.fn((q: string) => ({
    matches: q === `(display-mode: ${modo})`, media: q, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

const matchMediaOriginal = window.matchMedia

beforeEach(() => {
  capacitor.isNativePlatform.mockReturnValue(false)
  capacitor.getPlatform.mockReturnValue('web')
  simularDisplayMode('browser')
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.matchMedia = matchMediaOriginal
})

describe('almacén de la sesión', () => {
  it('pestaña del navegador: sessionStorage, la sesión muere con la pestaña', () => {
    expect(sesionPersistente()).toBe(false)
    expect(almacenDeSesion()).toBe(window.sessionStorage)
  })

  it('pestaña en pantalla completa (F11, modo quiosco): sigue siendo una pestaña', () => {
    // Un equipo compartido con el navegador a pantalla completa no debe quedarse
    // con la sesión de nadie.
    simularDisplayMode('fullscreen')
    expect(sesionPersistente()).toBe(false)
    expect(almacenDeSesion()).toBe(window.sessionStorage)
  })

  it('navegador sin matchMedia: se trata como una pestaña normal', () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia
    expect(almacenDeSesion()).toBe(window.sessionStorage)
  })

  it('web instalada como app: localStorage, la sesión sobrevive a cerrarla', () => {
    simularDisplayMode('standalone')
    expect(sesionPersistente()).toBe(true)
    expect(almacenDeSesion()).toBe(window.localStorage)
  })

  it('web instalada en iPhone/iPad (navigator.standalone): también', () => {
    vi.stubGlobal('navigator', { userAgent: 'iPhone', maxTouchPoints: 5, standalone: true })
    expect(almacenDeSesion()).toBe(window.localStorage)
  })

  it.each(['ios', 'android'] as const)('app nativa de %s: localStorage', (plataforma) => {
    capacitor.isNativePlatform.mockReturnValue(true)
    capacitor.getPlatform.mockReturnValue(plataforma)
    expect(sesionPersistente()).toBe(true)
    expect(almacenDeSesion()).toBe(window.localStorage)
  })

  it('el almacén es síncrono: getItem devuelve el valor, no una promesa', () => {
    // Un almacén asíncrono colgaba el login en iOS (ver authStorage.ts).
    simularDisplayMode('standalone')
    const almacen = almacenDeSesion()
    almacen.setItem('at-prueba-almacen', 'x')
    expect(almacen.getItem('at-prueba-almacen')).toBe('x')
    almacen.removeItem('at-prueba-almacen')
  })
})
