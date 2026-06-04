import { describe, it, expect, beforeEach } from 'vitest'
import { getStoredSession, storeSession, clearSession } from '../authSession'
import type { UserSession } from '../../types'

function makeSession(overrides: Partial<UserSession> = {}): UserSession {
  return {
    user_id: 'u-1',
    email: 'a@b.com',
    name: 'Tester',
    role: 'admin',
    login_time: '2026-06-03T00:00:00.000Z',
    // Por defecto expira en el futuro lejano para que sea válida.
    expires_at: '2099-01-01T00:00:00.000Z',
    permissions: new Set(['agua.ver', 'condominios.tab.cuotas']),
    ...overrides,
  }
}

describe('authSession', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('devuelve null cuando no hay sesión almacenada', () => {
    expect(getStoredSession()).toBeNull()
  })

  it('round-trip: persiste y rehidrata permissions como Set', () => {
    const session = makeSession()
    storeSession(session)

    const restored = getStoredSession()
    expect(restored).not.toBeNull()
    expect(restored!.user_id).toBe('u-1')
    expect(restored!.permissions).toBeInstanceOf(Set)
    expect(restored!.permissions!.has('agua.ver')).toBe(true)
    expect(restored!.permissions!.has('condominios.tab.cuotas')).toBe(true)
  })

  it('trata una sesión expirada como ausente', () => {
    storeSession(makeSession({ expires_at: '2000-01-01T00:00:00.000Z' }))
    expect(getStoredSession()).toBeNull()
  })

  it('persiste sin permissions sin romper la rehidratación', () => {
    storeSession(makeSession({ permissions: undefined }))
    const restored = getStoredSession()
    expect(restored).not.toBeNull()
    expect(restored!.permissions).toBeUndefined()
  })

  it('tolera JSON corrupto devolviendo null', () => {
    sessionStorage.setItem('userSession', '{broken')
    expect(getStoredSession()).toBeNull()
  })

  it('clearSession borra la sesión y la clave legacy de localStorage', () => {
    storeSession(makeSession())
    localStorage.setItem('cached_session', 'legacy-blob')

    clearSession()

    expect(getStoredSession()).toBeNull()
    expect(sessionStorage.getItem('userSession')).toBeNull()
    expect(localStorage.getItem('cached_session')).toBeNull()
  })
})
