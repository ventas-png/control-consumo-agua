import { describe, it, expect } from 'vitest'
import { extractOAuthCallbackError, describeOAuthCallbackError } from '../oauthCallbackError'

describe('extractOAuthCallbackError', () => {
  it('devuelve null cuando la URL no trae parámetros de error', () => {
    const r = extractOAuthCallbackError('#access_token=abc&type=recovery', '?lang=en')
    expect(r.error).toBeNull()
    expect(r.cleanedHash).toBe('#access_token=abc&type=recovery')
    expect(r.cleanedSearch).toBe('?lang=en')
  })

  it('extrae el error del fragment (flujo implícito de GoTrue) y limpia el hash', () => {
    const hash = '#error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code%3A+4%2F0Axyz'
    const r = extractOAuthCallbackError(hash, '')
    expect(r.error).toEqual({
      code: 'unexpected_failure',
      description: 'Unable to exchange external code: 4/0Axyz',
    })
    expect(r.cleanedHash).toBe('')
    expect(r.cleanedSearch).toBe('')
  })

  it('extrae el error del query string como fallback y preserva otros params', () => {
    const r = extractOAuthCallbackError('', '?lang=en&error=access_denied&error_description=User+cancelled')
    expect(r.error).toEqual({ code: 'access_denied', description: 'User cancelled' })
    expect(r.cleanedSearch).toBe('?lang=en')
    expect(r.cleanedHash).toBe('')
  })

  it('cae a `error` cuando no hay error_code ni error_description', () => {
    const r = extractOAuthCallbackError('#error=server_error', '')
    expect(r.error).toEqual({ code: 'server_error', description: 'server_error' })
  })
})

describe('describeOAuthCallbackError', () => {
  it('marca como error de configuración el intercambio de código fallido', () => {
    const msg = describeOAuthCallbackError({
      code: 'unexpected_failure',
      description: 'Unable to exchange external code: 4/0Axyz',
    })
    expect(msg).toContain('error de configuración')
    expect(msg).toContain('Unable to exchange external code')
  })

  it('describe la cancelación del usuario sin alarmar', () => {
    const msg = describeOAuthCallbackError({ code: 'access_denied', description: 'User cancelled' })
    expect(msg).toContain('cancelado')
  })

  it('describe un enlace expirado', () => {
    const msg = describeOAuthCallbackError({
      code: 'otp_expired',
      description: 'Email link is invalid or has expired',
    })
    expect(msg).toContain('expiró')
  })

  it('mensaje genérico con el detalle técnico para el resto', () => {
    const msg = describeOAuthCallbackError({ code: 'server_error', description: 'boom' })
    expect(msg).toContain('No se pudo completar el inicio de sesión')
    expect(msg).toContain('boom')
  })
})
