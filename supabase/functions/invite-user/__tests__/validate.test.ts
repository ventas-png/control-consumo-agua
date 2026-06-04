// Tests de la lógica pura de invite-user (infra:I22 · Track T8). Como el resto de
// tests de edge fns, corre bajo vitest (no Deno) tratando el módulo como TS normal.
// Cubre: whitelist de roles invitables, etiqueta de rol, validación de email,
// generación de token (URL-safe + entropía) y cómputo de expiración (7 días).

import { describe, it, expect } from 'vitest'
import {
  INVITABLE_ROLES,
  INVITATION_TTL_MS,
  computeExpiresAt,
  generateToken,
  isInvitableRole,
  isValidEmail,
  roleLabel,
} from '../validate.ts'

describe('invite-user/isInvitableRole', () => {
  it('acepta los roles del whitelist', () => {
    for (const r of ['admin', 'operator', 'operador', 'viewer', 'visor', 'collector']) {
      expect(isInvitableRole(r)).toBe(true)
    }
  })

  it('NUNCA permite super_admin ni company_owner (escalada de privilegios)', () => {
    expect(isInvitableRole('super_admin')).toBe(false)
    expect(isInvitableRole('superadmin')).toBe(false)
    expect(isInvitableRole('company_owner')).toBe(false)
  })

  it('rechaza roles desconocidos o vacíos', () => {
    expect(isInvitableRole('')).toBe(false)
    expect(isInvitableRole('root')).toBe(false)
    expect(isInvitableRole('Admin')).toBe(false) // case-sensitive a propósito
  })

  it('el whitelist coincide con la constante exportada (sin duplicados extra)', () => {
    expect(INVITABLE_ROLES).toEqual(['admin', 'operator', 'operador', 'viewer', 'visor', 'collector'])
  })
})

describe('invite-user/roleLabel', () => {
  it('mapea cada rol a su etiqueta es-MX', () => {
    expect(roleLabel('admin')).toBe('Administrador')
    expect(roleLabel('operator')).toBe('Operador')
    expect(roleLabel('operador')).toBe('Operador')
    expect(roleLabel('viewer')).toBe('Visualizador')
    expect(roleLabel('visor')).toBe('Visualizador')
    expect(roleLabel('collector')).toBe('Cobros')
  })

  it('cae al propio rol si no hay etiqueta', () => {
    expect(roleLabel('rol_raro')).toBe('rol_raro')
  })
})

describe('invite-user/isValidEmail', () => {
  it('acepta emails bien formados', () => {
    expect(isValidEmail('a@b.com')).toBe(true)
    expect(isValidEmail('juan.perez@mayan-residenciales.com.mx')).toBe(true)
  })

  it('rechaza formatos inválidos', () => {
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail('no-arroba')).toBe(false)
    expect(isValidEmail('a@b')).toBe(false) // sin TLD
    expect(isValidEmail('a @b.com')).toBe(false) // espacio
    expect(isValidEmail('a@@b.com')).toBe(false)
  })
})

describe('invite-user/generateToken', () => {
  it('produce un token URL-safe (sin + / = , solo base64url)', () => {
    const t = generateToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('32 bytes → 43 chars base64url (sin padding)', () => {
    expect(generateToken()).toHaveLength(43)
  })

  it('es prácticamente único entre invocaciones (alta entropía)', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateToken()))
    expect(tokens.size).toBe(50)
  })
})

describe('invite-user/computeExpiresAt', () => {
  it('expira exactamente 7 días después del now inyectado', () => {
    const now = Date.parse('2026-06-04T00:00:00.000Z')
    expect(computeExpiresAt(now)).toBe('2026-06-11T00:00:00.000Z')
  })

  it('la TTL es de 7 días en ms', () => {
    expect(INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('devuelve un ISO string parseable en el futuro respecto al now', () => {
    const now = Date.now()
    const exp = Date.parse(computeExpiresAt(now))
    expect(exp).toBeGreaterThan(now)
  })
})
