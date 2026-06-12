// Tests de la recuperación de login tardío (sesión que llega después del
// timeout del login). Lógica pura con inyección de getSession — sin red.
import { describe, it, expect, vi } from 'vitest'
import { waitForLateSession } from '../lateSession'

const OPTS = { attempts: 3, delayMs: 5, attemptTimeoutMs: 20 }

describe('waitForLateSession', () => {
  it('devuelve la sesión si el primer intento la encuentra', async () => {
    const getSession = vi.fn().mockResolvedValue({ user: 'u1' })
    await expect(waitForLateSession(getSession, OPTS)).resolves.toEqual({ user: 'u1' })
    expect(getSession).toHaveBeenCalledTimes(1)
  })

  it('reintenta y devuelve la sesión que aparece en un intento posterior', async () => {
    const getSession = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ user: 'u2' })
    await expect(waitForLateSession(getSession, OPTS)).resolves.toEqual({ user: 'u2' })
    expect(getSession).toHaveBeenCalledTimes(3)
  })

  it('agota los intentos sin sesión → null', async () => {
    const getSession = vi.fn().mockResolvedValue(null)
    await expect(waitForLateSession(getSession, OPTS)).resolves.toBeNull()
    expect(getSession).toHaveBeenCalledTimes(3)
  })

  it('un intento que falla cuenta como null y no lanza', async () => {
    const getSession = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ user: 'u3' })
    await expect(waitForLateSession(getSession, OPTS)).resolves.toEqual({ user: 'u3' })
  })

  it('un intento colgado se abandona al vencer su timeout', async () => {
    const getSession = vi.fn()
      .mockImplementationOnce(() => new Promise(() => { /* nunca resuelve */ }))
      .mockResolvedValueOnce({ user: 'u4' })
    await expect(waitForLateSession(getSession, OPTS)).resolves.toEqual({ user: 'u4' })
    expect(getSession).toHaveBeenCalledTimes(2)
  })

  it('todos colgados → null sin quedarse esperando', async () => {
    const getSession = vi.fn(() => new Promise<null>(() => { /* nunca resuelve */ }))
    await expect(waitForLateSession(getSession, OPTS)).resolves.toBeNull()
    expect(getSession).toHaveBeenCalledTimes(3)
  })
})
