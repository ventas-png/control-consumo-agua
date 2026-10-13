// Paridad CLIENTE ↔ SERVIDOR de «quién es el principal» y de las compuertas que espejan a las funciones de borde.
// El servidor compara app_users.role con texto EXACTO (is_company_owner(): = 'company_owner'; is_super_admin(): IN ('super_admin','superadmin')), y el CHECK
// app_users_role_check de producción (leído por SELECT el 2026-10-12) admite exactamente estos 11 valores.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}), auth: {} } }))

import {
  esPrincipalEmpresa, necesitaAsistentePrimerProyecto, puedeCrearProyectos, puedeEditarAsignaciones, puedeEliminarUsuario, veAsistentePrimerProyecto, ROLES_ELIMINABLES,
} from '../usuarios'
import { isPrincipalRole as principalCreate, canCreateRole, createRoleDenial } from '../../../../supabase/functions/create-user/validate'
import { isPrincipalRole as principalInvite, canInviteRole } from '../../../../supabase/functions/invite-user/validate'
import { DELETABLE_ROLES, canManageUsers, checkDeleteTargetGate, isSuperAdminRole } from '../../../../supabase/functions/delete-user/validate'

const ROLES_CHECK_PRODUCCION = ['super_admin', 'superadmin', 'company_owner', 'admin', 'operator', 'user', 'viewer', 'visor', 'operador', 'cliente', 'collector']
// lo que ESPERA el servidor (is_super_admin() OR is_company_owner())
const PRINCIPAL_SERVIDOR = new Set(['super_admin', 'superadmin', 'company_owner'])

describe('paridad del principal entre cliente, create-user, invite-user y el servidor', () => {
  it.each(ROLES_CHECK_PRODUCCION)('rol «%s»: cliente, create-user e invite-user coinciden con is_super_admin() OR is_company_owner()', rol => {
    const esperado = PRINCIPAL_SERVIDOR.has(rol)
    expect(esPrincipalEmpresa(rol)).toBe(esperado)
    expect(principalCreate(rol)).toBe(esperado)
    expect(principalInvite(rol)).toBe(esperado)
    expect(puedeCrearProyectos(rol)).toBe(esperado)
  })

  it.each(ROLES_CHECK_PRODUCCION)('rol «%s»: create-user/invite-user otorgan «admin» exactamente a quien el cliente llama principal', rol => {
    expect(canCreateRole(rol, 'admin')).toBe(esPrincipalEmpresa(rol))
    expect(canInviteRole(rol, 'admin')).toBe(esPrincipalEmpresa(rol))
  })

  it.each(['Company_Owner', 'COMPANY_OWNER', ' company_owner', 'company_owner ', 'owner', 'Super_Admin', 'SUPERADMIN', 'super-admin', 'superAdmin', 'Admin', 'ADMIN', 'administrador', '', ' ', 'null', 'undefined'])(
    'grafía «%s»: no es el principal para ninguno (el servidor compara texto exacto)', rol => {
      expect(esPrincipalEmpresa(rol)).toBe(false)
      expect(principalCreate(rol)).toBe(false)
      expect(principalInvite(rol)).toBe(false)
      expect(canCreateRole(rol, 'admin')).toBe(false)
      expect(canInviteRole(rol, 'admin')).toBe(false)
    })

  it('veAsistentePrimerProyecto es un subconjunto ESTRICTO del principal: sólo company_owner (el superadministrador administra desde /superadmin)', () => {
    for (const rol of ROLES_CHECK_PRODUCCION) {
      if (veAsistentePrimerProyecto(rol)) expect(esPrincipalEmpresa(rol)).toBe(true)
    }
    expect(ROLES_CHECK_PRODUCCION.filter(veAsistentePrimerProyecto)).toEqual(['company_owner'])
  })

  it('puedeEditarAsignaciones: permitido ⇔ principal, para cualquier rol y cualquier par actor/objetivo (incluido el propio); motivo ⇔ no permitido', () => {
    for (const rol of ROLES_CHECK_PRODUCCION) {
      for (const [a, o] of [['a', 'a'], ['a', 'b'], ['', ''], ['x', '']] as const) {
        const r = puedeEditarAsignaciones({ id: a, role: rol }, { id: o })
        expect(r.permitido).toBe(esPrincipalEmpresa(rol))
        expect(r.motivo === null).toBe(r.permitido)
      }
    }
  })

  it('create-user: el motivo del 403 para el administrador sobre «admin» es el de «solo el propietario», no el de rol inválido', () => {
    expect(createRoleDenial('admin', 'admin')).toBe('Solo el propietario de la empresa puede crear administradores.')
    expect(createRoleDenial('admin', 'Admin')).toMatch(/Solo puedes crear usuarios con rol operador/)
    expect(createRoleDenial('company_owner', 'admin')).toBeNull()
  })
})

describe('puedeEliminarUsuario espeja el gate de delete-user (canManageUsers && checkDeleteTargetGate) para todos los pares de roles del CHECK', () => {
  // lo que decide el servidor: canManageUsers(actor) (403 «Insufficient permissions») y luego checkDeleteTargetGate con la empresa del llamador y la del objetivo
  const servidor = (actor: string, callerCompanyId: string | null, objetivo: string, targetCompanyId: string | null) =>
    canManageUsers(actor) && checkDeleteTargetGate({ isSuperAdmin: isSuperAdminRole(actor), callerRole: actor, callerCompanyId, target: { role: objetivo, company_id: targetCompanyId } }).ok
  const cliente = (actor: string, callerCompanyId: string | null, objetivo: string, targetCompanyId: string | null) =>
    puedeEliminarUsuario({ role: actor, company_id: callerCompanyId }, { role: objetivo, company_id: targetCompanyId })

  it('la lista de roles eliminables del cliente es la del servidor', () => {
    expect([...ROLES_ELIMINABLES].sort()).toEqual([...DELETABLE_ROLES].sort())
  })

  // misma empresa en los dos lados: la parte de ROLES, par a par
  for (const actor of ROLES_CHECK_PRODUCCION) {
    for (const objetivo of ROLES_CHECK_PRODUCCION) {
      it(`actor «${actor}» → objetivo «${objetivo}»`, () => {
        expect(cliente(actor, 'c1', objetivo, 'c1')).toBe(servidor(actor, 'c1', objetivo, 'c1'))
      })
    }
  }

  // VEDGE-06: la parte de EMPRESA. El servidor deniega a quien no es superadministrador sin empresa (company_id null o '': V8-06 b, null === null dejaba borrar) y
  // fuera de la suya; el cliente no recibía la empresa y ofrecía «Eliminar» igual. Los 121 pares por cada combinación (empresa del llamador, empresa del objetivo).
  const COMBINACIONES_EMPRESA: Array<[string, string | null, string | null]> = [
    ['misma empresa', 'c1', 'c1'],
    ['llamador sin empresa (null)', null, 'c1'],
    ["llamador con empresa vacía ('')", '', 'c1'],
    ['llamador de otra empresa', 'c2', 'c1'],
    ['los dos sin empresa (null, null)', null, null],
    ["los dos con empresa vacía ('', '')", '', ''],
    ['objetivo sin empresa (null)', 'c1', null],
    ["objetivo con empresa vacía ('')", 'c1', ''],
  ]
  it.each(COMBINACIONES_EMPRESA)('%s: los 121 pares de roles coinciden con el servidor (0 divergencias)', (_etq, callerCompanyId, targetCompanyId) => {
    const divergencias: string[] = []
    let pares = 0
    for (const actor of ROLES_CHECK_PRODUCCION) {
      for (const objetivo of ROLES_CHECK_PRODUCCION) {
        pares++
        const s = servidor(actor, callerCompanyId, objetivo, targetCompanyId)
        if (cliente(actor, callerCompanyId, objetivo, targetCompanyId) !== s) divergencias.push(`${actor} → ${objetivo}: servidor ${s}`)
      }
    }
    expect(pares).toBe(121)
    expect(divergencias).toEqual([])
  })

  it('fuera de la propia empresa, o sin empresa, sólo el superadministrador elimina (con cualquier grafía histórica)', () => {
    for (const [, callerCompanyId, targetCompanyId] of COMBINACIONES_EMPRESA.slice(1)) {
      for (const actor of ROLES_CHECK_PRODUCCION) {
        expect(cliente(actor, callerCompanyId, 'operator', targetCompanyId)).toBe(actor === 'super_admin' || actor === 'superadmin')
      }
    }
  })

  it('un administrador no elimina a otro administrador; el propietario y el superadministrador sí', () => {
    expect(cliente('admin', 'c1', 'admin', 'c1')).toBe(false)
    expect(cliente('company_owner', 'c1', 'admin', 'c1')).toBe(true)
    expect(cliente('super_admin', 'c1', 'admin', 'c1')).toBe(true)
    expect(cliente('admin', 'c1', 'operator', 'c1')).toBe(true)
  })

  it('el propietario sin empresa (null, undefined o vacía) no elimina a nadie; el superadministrador sin empresa sí', () => {
    for (const company_id of [null, undefined, '']) {
      expect(puedeEliminarUsuario({ role: 'company_owner', company_id }, { role: 'operator', company_id })).toBe(false)
      expect(puedeEliminarUsuario({ role: 'admin', company_id }, { role: 'operator', company_id })).toBe(false)
      expect(puedeEliminarUsuario({ role: 'super_admin', company_id }, { role: 'operator', company_id: 'c1' })).toBe(true)
    }
  })

  it('sin rol (null/undefined) nadie elimina ni se elimina', () => {
    expect(puedeEliminarUsuario({ role: null, company_id: 'c1' }, { role: 'operator', company_id: 'c1' })).toBe(false)
    expect(puedeEliminarUsuario({ role: undefined, company_id: 'c1' }, { role: 'operator', company_id: 'c1' })).toBe(false)
    expect(puedeEliminarUsuario({ role: 'company_owner', company_id: 'c1' }, { role: null, company_id: 'c1' })).toBe(false)
    expect(puedeEliminarUsuario({ role: 'company_owner', company_id: 'c1' }, { role: undefined, company_id: 'c1' })).toBe(false)
  })
})

describe('necesitaAsistentePrimerProyecto · toda la compuerta del asistente del primer proyecto (App.tsx), por comportamiento', () => {
  const base = { cargando: false, role: 'company_owner', veEmpresaEntera: true, companyId: 'c1', totalProyectos: 0 }

  it('el propietario de una empresa sin proyectos, con los datos ya cargados y viendo la empresa entera, ve el asistente', () => {
    expect(necesitaAsistentePrimerProyecto(base)).toBe(true)
  })

  it.each(ROLES_CHECK_PRODUCCION)('rol «%s» (todo lo demás cumplido): sólo company_owner lo ve; un administrador exento tampoco', rol => {
    expect(necesitaAsistentePrimerProyecto({ ...base, role: rol })).toBe(rol === 'company_owner')
  })

  it.each(['Company_Owner', ' company_owner', 'COMPANY_OWNER', 'owner', 'adm', 'administrador', 'admin', 'Admin', '', 'null'])('grafía «%s»: no es el propietario, no hay asistente', rol => {
    expect(necesitaAsistentePrimerProyecto({ ...base, role: rol })).toBe(false)
  })

  it('sin rol (null/undefined) no hay asistente', () => {
    expect(necesitaAsistentePrimerProyecto({ ...base, role: null })).toBe(false)
    expect(necesitaAsistentePrimerProyecto({ ...base, role: undefined })).toBe(false)
  })

  it('mientras los datos cargan no se abre (nunca parpadea)', () => {
    expect(necesitaAsistentePrimerProyecto({ ...base, cargando: true })).toBe(false)
  })

  it('si quien mira está acotado a sus proyectos («no veo ninguno» no significa «la empresa no tiene») no se abre', () => {
    expect(necesitaAsistentePrimerProyecto({ ...base, veEmpresaEntera: false })).toBe(false)
  })

  it('sin empresa no se abre', () => {
    for (const companyId of [null, undefined, '']) expect(necesitaAsistentePrimerProyecto({ ...base, companyId })).toBe(false)
  })

  it('una empresa que ya tiene proyectos jamás lo ve (1, 2, muchos)', () => {
    for (const totalProyectos of [1, 2, 8]) expect(necesitaAsistentePrimerProyecto({ ...base, totalProyectos })).toBe(false)
  })
})
