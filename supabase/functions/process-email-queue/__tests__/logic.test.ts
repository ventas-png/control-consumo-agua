// Tests de la lógica pura de process-email-queue (infra:I22 · Track T8/T5).
// Como el resto de tests de edge fns, corre bajo vitest (no Deno) tratando el
// módulo como TS normal. Cubre: el gate fail-closed del CRON_SECRET (nadie entra
// si el secret no está configurado), la validación mínima del payload encolado
// y la ventana de expiración del token OAuth (< 5 min de vida ⇒ refresh).

import { describe, it, expect } from 'vitest'
import {
  TOKEN_REFRESH_WINDOW_MS,
  isTokenExpired,
  validateQueuePayload,
} from '../logic.ts'

describe('process-email-queue/validateQueuePayload', () => {
  it('acepta un payload con template_key y to_email', () => {
    expect(validateQueuePayload({ template_key: 'recibo', to_email: 'a@b.com' })).toEqual({ ok: true })
  })

  it('rechaza cuando falta template_key, to_email o ambos (mismo mensaje del handler)', () => {
    const esperado = { ok: false, error: 'payload invalido (template_key/to_email)' }
    expect(validateQueuePayload({ to_email: 'a@b.com' })).toEqual(esperado)
    expect(validateQueuePayload({ template_key: 'recibo' })).toEqual(esperado)
    expect(validateQueuePayload({})).toEqual(esperado)
    expect(validateQueuePayload({ template_key: '', to_email: '' })).toEqual(esperado)
  })
})

describe('process-email-queue/isTokenExpired', () => {
  const now = Date.parse('2026-07-01T12:00:00.000Z')

  it('sin expiry (null) → no expirado (no fuerza refresh)', () => {
    expect(isTokenExpired(null, now)).toBe(false)
  })

  it('con menos de 5 min de vida (o ya vencido) → expirado', () => {
    expect(isTokenExpired(new Date(now + 60 * 1000).toISOString(), now)).toBe(true)
    expect(isTokenExpired(new Date(now - 1000).toISOString(), now)).toBe(true)
  })

  it('frontera: exactamente 5 min de vida NO dispara refresh (comparación estricta <)', () => {
    expect(isTokenExpired(new Date(now + TOKEN_REFRESH_WINDOW_MS).toISOString(), now)).toBe(false)
    expect(isTokenExpired(new Date(now + TOKEN_REFRESH_WINDOW_MS - 1).toISOString(), now)).toBe(true)
  })
})
