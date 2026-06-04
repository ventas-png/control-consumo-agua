// Tests de la lógica pura de accept-invitation (infra:I22 · Track T8). Corre bajo
// vitest tratando el módulo como TS normal. Cubre: fortaleza de contraseña, mapa
// RBAC rol→role_id, gate de estado de la invitación (idempotencia un-solo-uso +
// expiración → 409/410), y clasificación de error "usuario duplicado".

import { describe, it, expect } from 'vitest'
import {
  PLATFORM_ROLE_ID,
  checkInvitationUsable,
  isDuplicateUserError,
  platformRoleId,
  validatePassword,
} from '../validate.ts'

describe('accept-invitation/validatePassword', () => {
  it('acepta una contraseña fuerte', () => {
    expect(validatePassword('Abcdef12')).toBeNull()
  })

  it('exige al menos 8 caracteres', () => {
    expect(validatePassword('Ab1cde')).toMatch(/al menos 8/)
    expect(validatePassword('')).toMatch(/al menos 8/)
  })

  it('exige una mayúscula', () => {
    expect(validatePassword('abcdef12')).toMatch(/mayúscula/)
  })

  it('exige una minúscula', () => {
    expect(validatePassword('ABCDEF12')).toMatch(/minúscula/)
  })

  it('exige un número', () => {
    expect(validatePassword('Abcdefgh')).toMatch(/número/)
  })

  it('reporta el primer requisito incumplido en orden (longitud antes que clases)', () => {
    // 'abc' falla longitud primero aunque también falte mayúscula y número.
    expect(validatePassword('abc')).toMatch(/al menos 8/)
  })
})

describe('accept-invitation/platformRoleId (RBAC)', () => {
  it('mapea los roles con role_id de plataforma', () => {
    expect(platformRoleId('admin')).toBe('00000000-0000-0000-0000-000000000201')
    expect(platformRoleId('operator')).toBe('00000000-0000-0000-0000-000000000202')
    expect(platformRoleId('operador')).toBe('00000000-0000-0000-0000-000000000202')
    expect(platformRoleId('viewer')).toBe('00000000-0000-0000-0000-000000000203')
    expect(platformRoleId('visor')).toBe('00000000-0000-0000-0000-000000000203')
    expect(platformRoleId('collector')).toBe('00000000-0000-0000-0000-000000000204')
  })

  it('alias operador/operador y viewer/visor apuntan al MISMO role_id', () => {
    expect(platformRoleId('operator')).toBe(platformRoleId('operador'))
    expect(platformRoleId('viewer')).toBe(platformRoleId('visor'))
  })

  it('devuelve undefined para roles que bypassan RBAC (admin de empresa, owner)', () => {
    expect(platformRoleId('company_owner')).toBeUndefined()
    expect(platformRoleId('super_admin')).toBeUndefined()
    expect(platformRoleId('desconocido')).toBeUndefined()
  })

  it('el map exportado no expone role_id para super_admin/company_owner', () => {
    expect(PLATFORM_ROLE_ID).not.toHaveProperty('super_admin')
    expect(PLATFORM_ROLE_ID).not.toHaveProperty('company_owner')
  })
})

describe('accept-invitation/checkInvitationUsable', () => {
  const future = '2099-01-01T00:00:00.000Z'
  const past = '2000-01-01T00:00:00.000Z'
  const now = Date.parse('2026-06-04T00:00:00.000Z')

  it('permite una invitación pending y vigente', () => {
    expect(checkInvitationUsable({ status: 'pending', expiresAt: future }, now)).toEqual({ ok: true })
  })

  it('idempotencia: una invitación ya accepted → 409 "ya utilizada" (no re-crea)', () => {
    const r = checkInvitationUsable({ status: 'accepted', expiresAt: future }, now)
    expect(r).toEqual({ ok: false, status: 409, error: 'Esta invitación ya fue utilizada.', markExpired: false })
  })

  it('un estado revoked/expired (no-pending) → 409 "ya no está disponible"', () => {
    const r = checkInvitationUsable({ status: 'revoked', expiresAt: future }, now)
    expect(r).toMatchObject({ ok: false, status: 409, error: 'Esta invitación ya no está disponible.' })
  })

  it('pending pero expirada → 410 + flag markExpired', () => {
    const r = checkInvitationUsable({ status: 'pending', expiresAt: past }, now)
    expect(r).toEqual({ ok: false, status: 410, error: 'Esta invitación expiró. Pide una nueva.', markExpired: true })
  })

  it('el estado tiene prioridad sobre la expiración (accepted+expirada → 409, no 410)', () => {
    const r = checkInvitationUsable({ status: 'accepted', expiresAt: past }, now)
    expect(r).toMatchObject({ ok: false, status: 409 })
  })

  it('límite de expiración: justo en el now NO se considera expirada (< estricto)', () => {
    // expiresAt == now → getTime() < now es false → sigue usable.
    const r = checkInvitationUsable({ status: 'pending', expiresAt: new Date(now).toISOString() }, now)
    expect(r).toEqual({ ok: true })
  })
})

describe('accept-invitation/isDuplicateUserError', () => {
  it('detecta variantes de "email ya existe" (→ 409)', () => {
    expect(isDuplicateUserError('User already registered')).toBe(true)
    expect(isDuplicateUserError('A user with this email already exists')).toBe(true)
    expect(isDuplicateUserError('Email address is already registered')).toBe(true)
  })

  it('es case-insensitive', () => {
    expect(isDuplicateUserError('ALREADY EXISTS')).toBe(true)
  })

  it('un error genérico NO es duplicado (→ 500)', () => {
    expect(isDuplicateUserError('Database connection failed')).toBe(false)
    expect(isDuplicateUserError(null)).toBe(false)
    expect(isDuplicateUserError(undefined)).toBe(false)
    expect(isDuplicateUserError('')).toBe(false)
  })
})
