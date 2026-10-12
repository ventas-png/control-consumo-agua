// Tests de la lógica pura de create-user (infra:I22 · Track T8/T5). Como el
// resto de tests de edge fns, corre bajo vitest (no Deno) tratando el módulo
// como TS normal. Cubre: universo de roles que un no-super puede crear (la
// barrera anti-escalada), QUIÉN puede crear cada uno (canCreateRole: el rol
// 'admin' solo lo otorga el principal de la empresa), gate del caller,
// validación de tipos del cuerpo, normalización de email, campos requeridos y el
// mapping de roles RBAC de plataforma.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  ALLOWED_ROLES_FOR_NON_SUPER,
  MSG_SOLO_PRINCIPAL_ADMIN,
  PLATFORM_ROLE_ID,
  ROLES_SOLO_PRINCIPAL,
  canCreateRole,
  canManageUsers,
  createRoleDenial,
  hasMissingRequiredFields,
  isPrincipalRole,
  isRoleAllowedForNonSuper,
  isSuperAdminRole,
  isTextOrAbsent,
  normalizeEmail,
  platformRoleIdFor,
} from '../validate.ts'
import { INVITABLE_ROLES, ROLES_SOLO_PRINCIPAL as INVITE_SOLO_PRINCIPAL, canInviteRole, isTextOrAbsent as isTextOrAbsentInvite } from '../../invite-user/validate.ts'

describe('create-user/isRoleAllowedForNonSuper (el UNIVERSO que algún no-super puede otorgar; quién, ver canCreateRole)', () => {
  it('acepta los roles del universo', () => {
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

  it('el universo es exactamente el esperado y espeja el de invite-user', () => {
    expect(ALLOWED_ROLES_FOR_NON_SUPER).toEqual(['admin', 'operator', 'operador', 'viewer', 'visor', 'collector'])
    // Las dos vías de alta (directa e invitación) deben otorgar los mismos roles.
    expect(ALLOWED_ROLES_FOR_NON_SUPER).toEqual(INVITABLE_ROLES)
  })

  it("los roles que SOLO otorga el principal son exactamente ['admin'] y son los mismos en las dos vías de alta", () => {
    expect(ROLES_SOLO_PRINCIPAL).toEqual(['admin'])
    expect(INVITE_SOLO_PRINCIPAL).toEqual(ROLES_SOLO_PRINCIPAL)
    for (const r of ROLES_SOLO_PRINCIPAL) expect(ALLOWED_ROLES_FOR_NON_SUPER).toContain(r)
  })
})

describe('create-user/isPrincipalRole', () => {
  it('el principal es company_owner o super_admin/superadmin; el administrador NO lo es', () => {
    for (const r of ['company_owner', 'super_admin', 'superadmin']) expect(isPrincipalRole(r)).toBe(true)
    for (const r of ['admin', 'operator', 'operador', 'viewer', 'visor', 'collector', 'cliente', '', 'Company_Owner']) {
      expect(isPrincipalRole(r)).toBe(false)
    }
  })
})

describe('create-user/canCreateRole · quién puede crear a quién (decisión del dueño 2026-10-11: el principal)', () => {
  const NO_ADMIN = ['operator', 'operador', 'viewer', 'visor', 'collector']

  it('el superadministrador (ambas grafías) crea cualquier rol, también al company_owner de una empresa nueva', () => {
    for (const caller of ['super_admin', 'superadmin']) {
      for (const target of [...ALLOWED_ROLES_FOR_NON_SUPER, 'company_owner']) expect(canCreateRole(caller, target)).toBe(true)
    }
  })

  it('el propietario crea todo el universo, administrador incluido; nunca super_admin ni company_owner', () => {
    for (const target of ALLOWED_ROLES_FOR_NON_SUPER) expect(canCreateRole('company_owner', target)).toBe(true)
    for (const target of ['super_admin', 'superadmin', 'company_owner', 'cliente', '', 'root']) expect(canCreateRole('company_owner', target)).toBe(false)
  })

  it('el ADMINISTRADOR crea operador, visor y cobros pero NO administradores (ni propietario ni superadministrador)', () => {
    for (const target of NO_ADMIN) expect(canCreateRole('admin', target)).toBe(true)
    expect(canCreateRole('admin', 'admin')).toBe(false)
    for (const target of ['super_admin', 'superadmin', 'company_owner', 'cliente', '', 'root']) expect(canCreateRole('admin', target)).toBe(false)
  })

  it('el motivo es claro: un administrador que pide admin recibe «solo el propietario»; otro rol fuera del universo, la lista de lo que sí puede', () => {
    expect(createRoleDenial('admin', 'admin')).toBe(MSG_SOLO_PRINCIPAL_ADMIN)
    expect(MSG_SOLO_PRINCIPAL_ADMIN).toMatch(/propietario/)
    expect(createRoleDenial('admin', 'company_owner')).toBe('Solo puedes crear usuarios con rol operador/visualizador/cobros')
    expect(createRoleDenial('company_owner', 'root')).toBe('Solo puedes crear usuarios con rol admin/operador/visualizador/cobros')
    expect(createRoleDenial('admin', 'operator')).toBeNull()
    expect(createRoleDenial('company_owner', 'admin')).toBeNull()
  })

  it('quien no gestiona usuarios (operador, visor, cobros, cliente, vacío) no crea NADA', () => {
    for (const caller of ['operator', 'operador', 'viewer', 'visor', 'collector', 'cliente', '']) {
      for (const target of [...ALLOWED_ROLES_FOR_NON_SUPER, 'company_owner']) expect(canCreateRole(caller, target)).toBe(false)
    }
  })

  it('un rol con la grafía distinta no se cuela (case-sensitive)', () => {
    expect(canCreateRole('Admin', 'operator')).toBe(false)
    expect(canCreateRole('admin', 'Admin')).toBe(false)
    expect(canCreateRole('COMPANY_OWNER', 'admin')).toBe(false)
  })

  it('create-user e invite-user dan la MISMA respuesta sobre el universo compartido, para cada llamador', () => {
    for (const caller of ['super_admin', 'superadmin', 'company_owner', 'admin', 'operator', 'viewer', 'collector', 'cliente', '']) {
      for (const target of ALLOWED_ROLES_FOR_NON_SUPER) expect(canInviteRole(caller, target)).toBe(canCreateRole(caller, target))
    }
  })

  it('el handler USA canCreateRole vía createRoleDenial (no una lista fija) y ya no consulta isRoleAllowedForNonSuper', () => {
    const src = readFileSync(resolve('supabase/functions/create-user/index.ts'), 'utf-8')
    expect(src).toMatch(/createRoleDenial\(callerRole, role\)/)
    expect(src).not.toMatch(/isRoleAllowedForNonSuper/)
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

describe('create-user/isTextOrAbsent (el cuerpo llega de la red: sólo texto o ausente llega a createUser / app_users)', () => {
  it('texto, undefined y null pasan; arreglo, objeto, número, booleano y función NO', () => {
    for (const v of ['', 'Abcdef12', ' a@b.co ', undefined, null]) expect(isTextOrAbsent(v)).toBe(true)
    for (const v of [['x'], {}, { v: 'x' }, 0, 7, true, false, () => 'x']) expect(isTextOrAbsent(v)).toBe(false)
  })

  it('espeja el de invite-user (misma regla en las tres funciones de usuarios)', () => {
    for (const v of ['', 'x', undefined, null, ['x'], {}, 0, 7, true, false]) expect(isTextOrAbsent(v)).toBe(isTextOrAbsentInvite(v))
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
