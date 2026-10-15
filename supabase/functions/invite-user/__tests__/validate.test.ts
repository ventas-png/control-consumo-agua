// Tests de la lógica pura de invite-user (infra:I22 · Track T8). Como el resto de
// tests de edge fns, corre bajo vitest (no Deno) tratando el módulo como TS normal.
// Cubre: universo de roles invitables, QUIÉN puede invitar cada uno (canInviteRole: el rol
// 'admin' solo lo invita el principal de la empresa), etiqueta de rol, validación de email,
// generación de token (URL-safe + entropía), cómputo de expiración (7 días) y los mensajes
// y el registro de los fallos del INSERT.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  INVITABLE_ROLES,
  INVITATION_TTL_MS,
  MSG_PENDIENTE_DEL_PROPIETARIO,
  MSG_PENDIENTE_RECIEN_CREADA,
  MSG_SOLO_PRINCIPAL_ADMIN,
  ROLES_SOLO_PRINCIPAL,
  canInviteRole,
  computeExpiresAt,
  generateToken,
  idsPendientesARevocar,
  isInvitableRole,
  isPrincipalRole,
  isTextOrAbsent,
  isValidEmail,
  msgConflictoPendiente,
  registroErrorBd,
  roleLabel,
} from '../validate.ts'

describe('invite-user/isInvitableRole (el UNIVERSO invitable; quién puede invitar, ver canInviteRole)', () => {
  it('acepta los roles del universo', () => {
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

  it('el universo coincide con la constante exportada (sin duplicados extra)', () => {
    expect(INVITABLE_ROLES).toEqual(['admin', 'operator', 'operador', 'viewer', 'visor', 'collector'])
  })
})

describe('invite-user/canInviteRole · quién puede invitar a quién (decisión del dueño 2026-10-11: el principal)', () => {
  const NO_ADMIN = ['operator', 'operador', 'viewer', 'visor', 'collector']

  it("los roles que SOLO invita el principal son exactamente ['admin']", () => {
    expect(ROLES_SOLO_PRINCIPAL).toEqual(['admin'])
    expect(MSG_SOLO_PRINCIPAL_ADMIN).toMatch(/propietario/)
  })

  it('el principal (propietario y superadministrador, ambas grafías) invita a todo el universo, administrador incluido', () => {
    for (const caller of ['company_owner', 'super_admin', 'superadmin']) {
      expect(isPrincipalRole(caller)).toBe(true)
      for (const target of INVITABLE_ROLES) expect(canInviteRole(caller, target)).toBe(true)
    }
  })

  it('el ADMINISTRADOR invita operador, visor y cobros pero NO administradores', () => {
    expect(isPrincipalRole('admin')).toBe(false)
    for (const target of NO_ADMIN) expect(canInviteRole('admin', target)).toBe(true)
    expect(canInviteRole('admin', 'admin')).toBe(false)
  })

  it('nadie invita super_admin ni company_owner por esta vía, ni roles desconocidos, tampoco el superadministrador', () => {
    for (const caller of ['company_owner', 'super_admin', 'superadmin', 'admin']) {
      for (const target of ['super_admin', 'superadmin', 'company_owner', 'cliente', '', 'root', 'Admin']) expect(canInviteRole(caller, target)).toBe(false)
    }
  })

  it('quien no gestiona usuarios (operador, visor, cobros, cliente, vacío) no invita NADA', () => {
    for (const caller of ['operator', 'operador', 'viewer', 'visor', 'collector', 'cliente', '']) {
      for (const target of INVITABLE_ROLES) expect(canInviteRole(caller, target)).toBe(false)
    }
  })

  it('el handler USA canInviteRole (403 con el motivo) además de validar que el rol sea invitable', () => {
    const src = readFileSync(resolve('supabase/functions/invite-user/index.ts'), 'utf-8')
    expect(src).toMatch(/canInviteRole\(callerRole, role\)/)
    expect(src).toMatch(/MSG_SOLO_PRINCIPAL_ADMIN/)
    expect(src).toMatch(/status: 403/)
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

describe('invite-user/isTextOrAbsent (el cuerpo llega de la red: sólo texto o ausente se recorta)', () => {
  it('texto, undefined y null pasan', () => {
    for (const v of ['', 'admin', ' admin ', undefined, null]) expect(isTextOrAbsent(v)).toBe(true)
  })
  it('arreglo, objeto, número y booleano NO (recortarlos lanzaba TypeError → 500)', () => {
    for (const v of [['admin'], {}, { role: 'admin' }, 0, 7, true, false, () => 'admin']) expect(isTextOrAbsent(v)).toBe(false)
  })
})

describe('invite-user/msgConflictoPendiente · registroErrorBd (409 y 500 del INSERT)', () => {
  it('al principal no se le dice que «la gestiona el propietario»: se le pide recargar; al no principal, sí (V8-07 B2)', () => {
    expect(msgConflictoPendiente(true)).toBe(MSG_PENDIENTE_RECIEN_CREADA)
    expect(msgConflictoPendiente(true)).not.toMatch(/propietario/)
    expect(msgConflictoPendiente(false)).toBe(MSG_PENDIENTE_DEL_PROPIETARIO)
    expect(MSG_PENDIENTE_DEL_PROPIETARIO).toMatch(/propietario/)
  })
  it('del error de la base de datos se registra código y mensaje, NO details ni hint (repiten el correo invitado) (V8-08)', () => {
    const r = registroErrorBd({ code: '23505', message: 'duplicate key', details: 'Key (company_id, email)=(c, ana@ejemplo.com) already exists.', hint: 'h' } as { code: string; message: string })
    expect(r).toEqual({ code: '23505', message: 'duplicate key' })
    expect(JSON.stringify(r)).not.toContain('ana@ejemplo.com')
    expect(registroErrorBd({})).toEqual({ code: null, message: null })
  })
})

describe('invite-user/idsPendientesARevocar (qué pendientes revoca invitar de nuevo al mismo correo)', () => {
  const pendientes = [
    { id: 'a', email: 'ana@ejemplo.com', role: 'operator' },
    { id: 'b', email: 'Ana@Ejemplo.com ', role: 'admin' },
    { id: 'c', email: 'otra@ejemplo.com', role: 'operator' },
    { id: 'd', email: null, role: 'viewer' },
  ]
  it('el principal revoca todas las del mismo correo (recortado y en minúsculas), también la de admin', () => {
    expect(idsPendientesARevocar(pendientes, 'ana@ejemplo.com', true)).toEqual(['a', 'b'])
  })
  it('quien NO es el principal no revoca las de rol admin', () => {
    expect(idsPendientesARevocar(pendientes, 'ana@ejemplo.com', false)).toEqual(['a'])
  })
  it('comodines de LIKE y de PostgREST no amplían nada: la comparación es de igualdad exacta', () => {
    for (const patron of ['%@%.%', '_@_._', '*@*.*', 'ana@ejemplo.%', 'a\\%']) expect(idsPendientesARevocar(pendientes, patron, true)).toEqual([])
  })
  it('sin pendientes o con filas sin correo no revoca nada', () => {
    expect(idsPendientesARevocar([], 'ana@ejemplo.com', true)).toEqual([])
    expect(idsPendientesARevocar([{ id: 'd', email: null, role: null }], '', true)).toEqual([])
  })
})
