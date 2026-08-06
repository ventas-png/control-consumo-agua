// Tests de la lógica pura de create-user (infra:I22 · Track T8/T5). Como el
// resto de tests de edge fns, corre bajo vitest (no Deno) tratando el módulo
// como TS normal. Cubre: whitelist de roles que un no-super puede crear (la
// barrera anti-escalada), gate del caller, normalización de email, campos
// requeridos y el mapping de roles RBAC de plataforma.

import { describe, it, expect } from 'vitest'
import {
  ALLOWED_ROLES_FOR_NON_SUPER,
  PLATFORM_ROLE_ID,
  canManageUsers,
  hasMissingRequiredFields,
  isRoleAllowedForNonSuper,
  isSuperAdminRole,
  normalizeEmail,
  platformRoleIdFor,
} from '../validate.ts'
import { INVITABLE_ROLES } from '../../invite-user/validate.ts'

describe('create-user/isRoleAllowedForNonSuper', () => {
  it('acepta los roles del whitelist', () => {
    for (const r of ['admin', 'operator', 'operador', 'viewer', 'visor', 'collector']) {
      expect(isRoleAllowedForNonSuper(r)).toBe(true)
    }
  })

  it('NUNCA permite crear super_admin ni company_owner (escalada de privilegios)', () => {
    expect(isRoleAllowedForNonSuper('super_admin')).toBe(false)
    expect(isRoleAllowedForNonSuper('superadmin')).toBe(false)
    expect(isRoleAllowedForNonSuper('company_owner')).toBe(false)
  })

  it('rechaza cliente, roles desconocidos, vacíos y variantes de mayúsculas', () => {
    expect(isRoleAllowedForNonSuper('cliente')).toBe(false)
    expect(isRoleAllowedForNonSuper('')).toBe(false)
    expect(isRoleAllowedForNonSuper('root')).toBe(false)
    expect(isRoleAllowedForNonSuper('Admin')).toBe(false) // case-sensitive a propósito
    expect(isRoleAllowedForNonSuper('SUPER_ADMIN')).toBe(false)
  })

  it('el whitelist es exactamente el esperado y espeja el de invite-user', () => {
    expect(ALLOWED_ROLES_FOR_NON_SUPER).toEqual(['admin', 'operator', 'operador', 'viewer', 'visor', 'collector'])
    // Las dos vías de alta (directa e invitación) deben otorgar los mismos roles.
    expect(ALLOWED_ROLES_FOR_NON_SUPER).toEqual(INVITABLE_ROLES)
  })
})

describe('create-user/canManageUsers · isSuperAdminRole', () => {
  it('solo super_admin / superadmin / company_owner / admin pasan el gate del caller', () => {
    for (const r of ['super_admin', 'superadmin', 'company_owner', 'admin']) {
      expect(canManageUsers(r)).toBe(true)
    }
  })

  it('operadores, visores, collectors, clientes y rol vacío quedan fuera (403)', () => {
    for (const r of ['operator', 'operador', 'viewer', 'visor', 'collector', 'cliente', '']) {
      expect(canManageUsers(r)).toBe(false)
    }
  })

  it('isSuperAdminRole reconoce ambas grafías y nada más', () => {
    expect(isSuperAdminRole('super_admin')).toBe(true)
    expect(isSuperAdminRole('superadmin')).toBe(true)
    expect(isSuperAdminRole('admin')).toBe(false)
    expect(isSuperAdminRole('company_owner')).toBe(false)
    expect(isSuperAdminRole('Super_Admin')).toBe(false) // case-sensitive
  })
})

describe('create-user/normalizeEmail', () => {
  it('recorta espacios y pasa a minúsculas (el login normaliza igual)', () => {
    expect(normalizeEmail('  Juan.Perez@Mayan.COM ')).toBe('juan.perez@mayan.com')
  })

  it('null/undefined → cadena vacía (cuenta como campo faltante)', () => {
    expect(normalizeEmail(null)).toBe('')
    expect(normalizeEmail(undefined)).toBe('')
  })

  it('un email de solo espacios queda vacío', () => {
    expect(normalizeEmail('   ')).toBe('')
  })
})

describe('create-user/hasMissingRequiredFields', () => {
  const full = {
    email: 'a@b.com',
    password: 'secreta123',
    full_name: 'Ana',
    role: 'admin',
    company_id: 'c1',
  }

  it('con todos los campos presentes no falta nada', () => {
    expect(hasMissingRequiredFields(full)).toBe(false)
  })

  it('cualquier campo vacío dispara el 400', () => {
    for (const k of ['email', 'password', 'full_name', 'role', 'company_id'] as const) {
      expect(hasMissingRequiredFields({ ...full, [k]: '' })).toBe(true)
    }
  })

  it('un email de solo espacios ya normalizado cuenta como faltante', () => {
    expect(hasMissingRequiredFields({ ...full, email: normalizeEmail('   ') })).toBe(true)
  })
})

describe('create-user/platformRoleIdFor', () => {
  it('mapea cada rol operativo a su rol de sistema RBAC (alias incluidos)', () => {
    expect(platformRoleIdFor('admin')).toBe('00000000-0000-0000-0000-000000000201')
    expect(platformRoleIdFor('operator')).toBe('00000000-0000-0000-0000-000000000202')
    expect(platformRoleIdFor('operador')).toBe('00000000-0000-0000-0000-000000000202')
    expect(platformRoleIdFor('viewer')).toBe('00000000-0000-0000-0000-000000000203')
    expect(platformRoleIdFor('visor')).toBe('00000000-0000-0000-0000-000000000203')
    expect(platformRoleIdFor('collector')).toBe('00000000-0000-0000-0000-000000000204')
  })

  it('super_admin / company_owner / cliente NO reciben rol de plataforma (EXEMPT_ROLES)', () => {
    expect(platformRoleIdFor('super_admin')).toBeUndefined()
    expect(platformRoleIdFor('superadmin')).toBeUndefined()
    expect(platformRoleIdFor('company_owner')).toBeUndefined()
    expect(platformRoleIdFor('cliente')).toBeUndefined()
  })

  it('todo rol del whitelist no-super tiene rol de plataforma (nadie queda sin permisos)', () => {
    for (const r of ALLOWED_ROLES_FOR_NON_SUPER) {
      expect(PLATFORM_ROLE_ID[r]).toBeDefined()
    }
  })
})
