// Tests de la lógica pura de log-security-event (infra:I22 · Track T8/T5).
// Como el resto de tests de edge fns, corre bajo vitest (no Deno) tratando el
// módulo como TS normal. Cubre: whitelist cerrado de eventos pre-auth (los
// demás exigen JWT), extracción de IP por orden de confianza y fila de
// security_logs (user_id solo del JWT — anti-spoofing).

import { describe, it, expect } from 'vitest'
import {
  PRE_AUTH_EVENTS,
  buildSecurityLogRow,
  getClientIP,
  isPreAuthEvent,
} from '../validate.ts'

describe('log-security-event/isPreAuthEvent', () => {
  it('solo los 4 eventos de login pueden registrarse sin JWT', () => {
    expect([...PRE_AUTH_EVENTS].sort()).toEqual([
      'failed_login_attempt',
      'login_error',
      'login_success',
      'password_reset_requested',
    ])
    for (const e of PRE_AUTH_EVENTS) expect(isPreAuthEvent(e)).toBe(true)
  })

  it('cualquier otro tipo exige autenticación (whitelist cerrado, case-sensitive)', () => {
    expect(isPreAuthEvent('permission_denied')).toBe(false)
    expect(isPreAuthEvent('role_changed')).toBe(false)
    expect(isPreAuthEvent('LOGIN_SUCCESS')).toBe(false)
    expect(isPreAuthEvent('')).toBe(false)
  })
})

describe('log-security-event/getClientIP', () => {
  it('cf-connecting-ip tiene prioridad sobre x-forwarded-for y fly-client-ip', () => {
    const headers = new Headers({
      'cf-connecting-ip': '1.1.1.1',
      'x-forwarded-for': '2.2.2.2, 3.3.3.3',
      'fly-client-ip': '4.4.4.4',
    })
    expect(getClientIP(headers)).toBe('1.1.1.1')
  })

  it('de x-forwarded-for toma solo el PRIMER hop (el cliente real), con trim', () => {
    expect(getClientIP(new Headers({ 'x-forwarded-for': ' 2.2.2.2 , 3.3.3.3' }))).toBe('2.2.2.2')
  })

  it('fly-client-ip es el último fallback antes de unknown', () => {
    expect(getClientIP(new Headers({ 'fly-client-ip': '4.4.4.4' }))).toBe('4.4.4.4')
    expect(getClientIP(new Headers())).toBe('unknown')
  })
})

describe('log-security-event/buildSecurityLogRow', () => {
  const baseInput = {
    verifiedUserId: 'u-1',
    eventType: 'permission_denied',
    details: { modulo: 'agua', accion: 'export' },
    ip: '187.180.10.5',
    userAgent: 'Mozilla/5.0',
    timestamp: '2026-07-01T10:00:00.000Z',
  }

  it('la fila usa el user_id del JWT verificado (el builder no acepta uno del body)', () => {
    const row = buildSecurityLogRow(baseInput)
    expect(row).toEqual({
      user_id: 'u-1',
      event_type: 'permission_denied',
      details: { modulo: 'agua', accion: 'export' },
      ip_address: '187.180.10.5',
      user_agent: 'Mozilla/5.0',
      timestamp: '2026-07-01T10:00:00.000Z',
    })
  })

  it('sin JWT (evento pre-auth) el user_id queda null, nunca inventado', () => {
    const row = buildSecurityLogRow({ ...baseInput, verifiedUserId: null, eventType: 'failed_login_attempt' })
    expect(row.user_id).toBeNull()
  })

  it('user_agent ausente → cadena vacía (no null, la columna no lo admite)', () => {
    const row = buildSecurityLogRow({ ...baseInput, userAgent: undefined })
    expect(row.user_agent).toBe('')
  })
})
