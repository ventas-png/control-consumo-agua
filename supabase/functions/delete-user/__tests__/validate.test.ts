// Tests de la lógica pura de delete-user (infra:I22 · Track T8/T5). Como el
// resto de tests de edge fns, corre bajo vitest (no Deno) tratando el módulo
// como TS normal. Cubre: quién puede borrar a quién (gate del caller + gate del
// target: cross-tenant y jerarquía de roles) y la fila de auditoría post-borrado.

import { describe, it, expect } from 'vitest'
import {
  DELETABLE_ROLES,
  MSG_SOLO_PRINCIPAL_ELIMINAR_ADMIN,
  ROLES_SOLO_PRINCIPAL_ELIMINAR,
  buildUserDeletedAudit,
  canManageUsers,
  checkDeleteTargetGate,
  isPrincipalRole,
  isSuperAdminRole,
} from '../validate.ts'
import { ALLOWED_ROLES_FOR_NON_SUPER } from '../../create-user/validate.ts'

describe('delete-user/DELETABLE_ROLES', () => {
  it('NUNCA incluye super_admin ni company_owner (un admin no puede borrar hacia arriba)', () => {
    expect(DELETABLE_ROLES).not.toContain('super_admin')
    expect(DELETABLE_ROLES).not.toContain('superadmin')
    expect(DELETABLE_ROLES).not.toContain('company_owner')
  })

  it('espeja el whitelist de create-user (simetría alta/baja)', () => {
    expect(DELETABLE_ROLES).toEqual(ALLOWED_ROLES_FOR_NON_SUPER)
  })
})

describe('delete-user/canManageUsers · isSuperAdminRole', () => {
  it('solo super_admin / superadmin / company_owner / admin pasan el gate del caller', () => {
    for (const r of ['super_admin', 'superadmin', 'company_owner', 'admin']) {
      expect(canManageUsers(r)).toBe(true)
    }
    for (const r of ['operator', 'viewer', 'collector', 'cliente', '']) {
      expect(canManageUsers(r)).toBe(false)
    }
  })

  it('isSuperAdminRole reconoce ambas grafías y nada más', () => {
    expect(isSuperAdminRole('super_admin')).toBe(true)
    expect(isSuperAdminRole('superadmin')).toBe(true)
    expect(isSuperAdminRole('company_owner')).toBe(false)
    expect(isSuperAdminRole('admin')).toBe(false)
  })
})

describe('delete-user/isPrincipalRole', () => {
  it('el principal es el propietario o el superadministrador (ambas grafías); un administrador no', () => {
    expect(isPrincipalRole('company_owner')).toBe(true)
    expect(isPrincipalRole('super_admin')).toBe(true)
    expect(isPrincipalRole('superadmin')).toBe(true)
    for (const role of ['admin', 'operator', 'viewer', 'collector', 'cliente', '', 'Company_Owner', 'owner']) expect(isPrincipalRole(role)).toBe(false)
  })
})

describe('delete-user/checkDeleteTargetGate', () => {
  it('super_admin puede borrar a cualquiera, incluso cross-tenant y owners', () => {
    expect(checkDeleteTargetGate({
      isSuperAdmin: true,
      callerRole: 'super_admin',
      callerCompanyId: null,
      target: { role: 'company_owner', company_id: 'otra-empresa' },
    })).toEqual({ ok: true })
  })

  it('no-super NO puede borrar usuarios de otra empresa (cross-tenant)', () => {
    const gate = checkDeleteTargetGate({
      isSuperAdmin: false,
      callerRole: 'admin',
      callerCompanyId: 'empresa-a',
      target: { role: 'viewer', company_id: 'empresa-b' },
    })
    expect(gate).toEqual({ ok: false, error: 'No puedes eliminar usuarios de otra empresa' })
  })

  it('no-super NO puede borrar a un company_owner ni a un super_admin de su empresa', () => {
    for (const role of ['company_owner', 'super_admin', 'superadmin']) {
      const gate = checkDeleteTargetGate({
        isSuperAdmin: false,
        callerRole: 'company_owner',
        callerCompanyId: 'empresa-a',
        target: { role, company_id: 'empresa-a' },
      })
      expect(gate).toEqual({ ok: false, error: 'No tienes permiso para eliminar a este usuario' })
    }
  })

  it('el PROPIETARIO SÍ puede borrar todos los roles gestionables de su propia empresa, también al administrador', () => {
    for (const role of DELETABLE_ROLES) {
      expect(checkDeleteTargetGate({
        isSuperAdmin: false,
        callerRole: 'company_owner',
        callerCompanyId: 'empresa-a',
        target: { role, company_id: 'empresa-a' },
      })).toEqual({ ok: true })
    }
  })

  it('un ADMINISTRADOR borra los roles gestionables de su empresa MENOS el de administrador (E-07: lo elimina el principal)', () => {
    for (const role of DELETABLE_ROLES.filter(r => !ROLES_SOLO_PRINCIPAL_ELIMINAR.includes(r))) {
      expect(checkDeleteTargetGate({
        isSuperAdmin: false,
        callerRole: 'admin',
        callerCompanyId: 'empresa-a',
        target: { role, company_id: 'empresa-a' },
      })).toEqual({ ok: true })
    }
    expect(ROLES_SOLO_PRINCIPAL_ELIMINAR).toEqual(['admin'])
    expect(checkDeleteTargetGate({
      isSuperAdmin: false,
      callerRole: 'admin',
      callerCompanyId: 'empresa-a',
      target: { role: 'admin', company_id: 'empresa-a' },
    })).toEqual({ ok: false, error: MSG_SOLO_PRINCIPAL_ELIMINAR_ADMIN })
  })

  it('un rol desconocido o vacío como llamador tampoco elimina administradores (el gate no depende de un valor por omisión)', () => {
    for (const callerRole of ['', 'operator', 'viewer', 'superadministrador', 'Company_Owner']) {
      expect(checkDeleteTargetGate({
        isSuperAdmin: false,
        callerRole,
        callerCompanyId: 'empresa-a',
        target: { role: 'admin', company_id: 'empresa-a' },
      })).toEqual({ ok: false, error: MSG_SOLO_PRINCIPAL_ELIMINAR_ADMIN })
    }
  })

  it('el check de empresa gana al de rol: owner de OTRA empresa → error cross-tenant', () => {
    const gate = checkDeleteTargetGate({
      isSuperAdmin: false,
      callerRole: 'admin',
      callerCompanyId: 'empresa-a',
      target: { role: 'company_owner', company_id: 'empresa-b' },
    })
    expect(gate).toEqual({ ok: false, error: 'No puedes eliminar usuarios de otra empresa' })
  })

  it('caller sin empresa (company_id null) solo alcanza targets sin empresa', () => {
    expect(checkDeleteTargetGate({
      isSuperAdmin: false,
      callerRole: 'admin',
      callerCompanyId: null,
      target: { role: 'viewer', company_id: 'empresa-a' },
    })).toEqual({ ok: false, error: 'No puedes eliminar usuarios de otra empresa' })
    expect(checkDeleteTargetGate({
      isSuperAdmin: false,
      callerRole: 'admin',
      callerCompanyId: null,
      target: { role: 'viewer', company_id: null },
    })).toEqual({ ok: true })
  })
})

describe('delete-user/buildUserDeletedAudit', () => {
  const target = { id: 'u-2', role: 'operador', company_id: 'empresa-a', full_name: 'Pedro Gómez' }

  it('target_user_id va null (la fila ya no existe) y la identidad se preserva en details', () => {
    const row = buildUserDeletedAudit('u-1', 'u-2', target)
    expect(row.target_user_id).toBeNull()
    expect(row.details).toEqual({
      deleted_user_id: 'u-2',
      full_name: 'Pedro Gómez',
      role: 'operador',
      company_id: 'empresa-a',
    })
  })

  it('registra al actor y la acción user_deleted', () => {
    const row = buildUserDeletedAudit('u-1', 'u-2', target)
    expect(row.actor_id).toBe('u-1')
    expect(row.action).toBe('user_deleted')
  })
})
