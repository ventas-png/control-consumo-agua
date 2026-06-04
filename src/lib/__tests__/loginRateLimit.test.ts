import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  recordLoginFailure,
  clearLoginFailures,
  getLoginLockoutMessage,
} from '../loginRateLimit'

// MAX_LOGIN_ATTEMPTS = 5, LOCKOUT_DURATION_MS = 60_000 (privados al módulo).
const MAX = 5

describe('loginRateLimit', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('no bloquea sin intentos previos', () => {
    expect(getLoginLockoutMessage()).toBeNull()
  })

  it('no bloquea por debajo del máximo de intentos', () => {
    for (let i = 0; i < MAX - 1; i++) recordLoginFailure()
    expect(getLoginLockoutMessage()).toBeNull()
  })

  it('bloquea al alcanzar el máximo de intentos', () => {
    for (let i = 0; i < MAX; i++) recordLoginFailure()
    expect(getLoginLockoutMessage()).toMatch(/Demasiados intentos fallidos/)
  })

  it('clearLoginFailures restablece el contador y desbloquea', () => {
    for (let i = 0; i < MAX; i++) recordLoginFailure()
    expect(getLoginLockoutMessage()).not.toBeNull()
    clearLoginFailures()
    expect(getLoginLockoutMessage()).toBeNull()
  })

  it('tolera JSON corrupto en storage tratándolo como sin fallos', () => {
    sessionStorage.setItem('login_failures', '{not json')
    expect(getLoginLockoutMessage()).toBeNull()
  })

  describe('expiración del lockout', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-03T00:00:00Z'))
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('auto-resetea una vez vencido el lockout (>60s)', () => {
      for (let i = 0; i < MAX; i++) recordLoginFailure()
      expect(getLoginLockoutMessage()).toMatch(/Demasiados/)

      vi.setSystemTime(new Date('2026-06-03T00:01:01Z')) // +61s
      expect(getLoginLockoutMessage()).toBeNull()
      // El efecto colateral limpió el contador.
      expect(sessionStorage.getItem('login_failures')).toBeNull()
    })
  })
})
