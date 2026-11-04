// Tests de la lógica pura de delete-own-account (cuerpo, compuertas, conteo del resto de la empresa, filas de auditoría) y de su PARIDAD con
// delete-user y delete-company: cada función se despliega con lo suyo, así que los helpers espejo se fijan aquí para que no diverjan.
import { describe, it, expect } from 'vitest'
import {
  CONFIRM_WORD,
  MSG_CONFIRMACION,
  MSG_CUERPO_INVALIDO,
  MSG_SUPERADMIN,
  buildAccountDeletedSecurityLog,
  buildSelfDeletedAudit,
  checkSelfDeleteGate,
  contarOtrosActivos,
  isAuthUserGone,
  isBenignStripeCancelError,
  isPrincipalRole,
  isSuperAdminRole,
  msgUltimoPropietarioConEquipo,
  parseSelfDeleteBody,
  type SelfProfile,
} from '../validate.ts'
import { isPrincipalRole as principalDeleteUser, isSuperAdminRole as superDeleteUser } from '../../delete-user/validate.ts'
import {
  isAuthUserGone as authGoneDeleteCompany,
  isBenignStripeCancelError as benignDeleteCompany,
  isSuperAdminRole as superDeleteCompany,
} from '../../delete-company/logic.ts'

// Los 11 valores del CHECK app_users_role_check de producción (ver usuarios.paridadServidor.test.ts).
const ROLES_CHECK_PRODUCCION = ['super_admin', 'superadmin', 'company_owner', 'admin', 'operator', 'user', 'viewer', 'visor', 'operador', 'cliente', 'collector']

function perfil(role: string, company_id: string | null = 'C'): SelfProfile {
  return { id: 'u-yo', role, company_id, full_name: 'Yo Mismo', cliente_id: role === 'cliente' ? 'cl-1' : null }
}
const NADIE = { propietarios: 0, equipo: 0 }

describe('delete-own-account/parseSelfDeleteBody', () => {
  it('la palabra exacta (con espacio sobrante tolerado) es un borrado real; dry_run:true es una previsualización', () => {
    expect(parseSelfDeleteBody({ confirm: CONFIRM_WORD })).toEqual({ ok: true, dryRun: false })
    expect(parseSelfDeleteBody({ confirm: `  ${CONFIRM_WORD} ` })).toEqual({ ok: true, dryRun: false })
    expect(parseSelfDeleteBody({ dry_run: true })).toEqual({ ok: true, dryRun: true })
    // dry_run gana: no hace falta la palabra para previsualizar
    expect(parseSelfDeleteBody({ dry_run: true, confirm: 'nada' })).toEqual({ ok: true, dryRun: true })
  })

  it('sin la palabra, en minúsculas, otra palabra, no texto o dry_run que no sea `true` → 400 con el mensaje de confirmación', () => {
    for (const body of [{}, { confirm: 'eliminar' }, { confirm: 'ELIMINAR mi cuenta' }, { confirm: ['ELIMINAR'] }, { confirm: 1 }, { dry_run: 'true' }, { dry_run: 1 }]) {
      expect(parseSelfDeleteBody(body)).toEqual({ ok: false, error: MSG_CONFIRMACION })
    }
  })

  it('un cuerpo que no es un objeto JSON (null, arreglo, número, texto) → 400 «Cuerpo inválido», nunca un TypeError', () => {
    for (const raw of [null, undefined, [], ['ELIMINAR'], 7, 'ELIMINAR', true]) {
      expect(parseSelfDeleteBody(raw)).toEqual({ ok: false, error: MSG_CUERPO_INVALIDO })
    }
  })
})

describe('delete-own-account/contarOtrosActivos', () => {
  it('cuenta propietarios y equipo activos; ignora al llamador, a los inactivos, a los superadministradores y a las cuentas de portal', () => {
    const rows = [
      { id: 'u-yo', role: 'company_owner', activo: true },     // el llamador
      { id: 'u-2', role: 'company_owner', activo: true },
      { id: 'u-3', role: 'company_owner', activo: false },     // inactivo
      { id: 'u-4', role: 'admin', activo: true },
      { id: 'u-5', role: 'operator', activo: true },
      { id: 'u-6', role: 'viewer', activo: false },            // inactivo
      { id: 'u-7', role: 'super_admin', activo: true },        // plataforma
      { id: 'u-8', role: 'superadmin', activo: true },         // plataforma
      { id: 'u-9', role: 'cliente', activo: true },            // portal
    ]
    expect(contarOtrosActivos(rows, 'u-yo')).toEqual({ propietarios: 1, equipo: 2 })
    expect(contarOtrosActivos([], 'u-yo')).toEqual(NADIE)
  })

  it('todos los roles del CHECK que no son principal ni cliente cuentan como equipo', () => {
    for (const role of ROLES_CHECK_PRODUCCION) {
      const r = contarOtrosActivos([{ id: 'u-2', role, activo: true }], 'u-yo')
      if (isSuperAdminRole(role) || role === 'cliente') expect(r).toEqual(NADIE)
      else if (role === 'company_owner') expect(r).toEqual({ propietarios: 1, equipo: 0 })
      else expect(r).toEqual({ propietarios: 0, equipo: 1 })
    }
  })
})

describe('delete-own-account/checkSelfDeleteGate', () => {
  it('un login sin perfil se borra (el acceso huérfano no puede quedar atado a un correo para siempre)', () => {
    expect(checkSelfDeleteGate({ profile: null, otros: NADIE })).toEqual({ ok: true, suspenderEmpresa: false })
  })

  it('el superadministrador (ambas grafías) no se borra a sí mismo: 403, aunque tenga empresa y esté solo', () => {
    for (const role of ['super_admin', 'superadmin']) {
      expect(checkSelfDeleteGate({ profile: perfil(role), otros: NADIE })).toEqual({ ok: false, status: 403, error: MSG_SUPERADMIN })
      expect(checkSelfDeleteGate({ profile: perfil(role, null), otros: NADIE })).toEqual({ ok: false, status: 403, error: MSG_SUPERADMIN })
    }
  })

  it('el propietario con OTRO propietario activo se borra y la empresa sigue (sin suspender)', () => {
    expect(checkSelfDeleteGate({ profile: perfil('company_owner'), otros: { propietarios: 1, equipo: 5 } })).toEqual({ ok: true, suspenderEmpresa: false })
    expect(checkSelfDeleteGate({ profile: perfil('company_owner'), otros: { propietarios: 2, equipo: 0 } })).toEqual({ ok: true, suspenderEmpresa: false })
  })

  it('el ÚNICO propietario con más gente activa: 409 con el remedio dentro de la app (y soporte como alternativa), singular y plural', () => {
    const uno = checkSelfDeleteGate({ profile: perfil('company_owner'), otros: { propietarios: 0, equipo: 1 } })
    expect(uno).toEqual({ ok: false, status: 409, error: msgUltimoPropietarioConEquipo(1) })
    expect(msgUltimoPropietarioConEquipo(1)).toMatch(/otra persona tiene acceso/)
    expect(msgUltimoPropietarioConEquipo(3)).toMatch(/3 personas más tienen acceso/)
    for (const m of [msgUltimoPropietarioConEquipo(1), msgUltimoPropietarioConEquipo(3)]) {
      expect(m).toMatch(/Empresa › Usuarios/)
      expect(m).toMatch(/soporte@administratodo\.com/)
    }
  })

  it('el ÚNICO propietario y solo: se borra y la empresa queda suspendida', () => {
    expect(checkSelfDeleteGate({ profile: perfil('company_owner'), otros: NADIE })).toEqual({ ok: true, suspenderEmpresa: true })
  })

  it('un propietario sin empresa (estado raro) se borra sin suspender nada', () => {
    expect(checkSelfDeleteGate({ profile: perfil('company_owner', null), otros: NADIE })).toEqual({ ok: true, suspenderEmpresa: false })
    expect(checkSelfDeleteGate({ profile: perfil('company_owner', ''), otros: NADIE })).toEqual({ ok: true, suspenderEmpresa: false })
  })

  it('el resto del staff y las cuentas de portal se borran sin tocar la empresa, haya o no más gente', () => {
    for (const role of ROLES_CHECK_PRODUCCION.filter((r) => !isPrincipalRole(r))) {
      for (const otros of [NADIE, { propietarios: 0, equipo: 4 }, { propietarios: 1, equipo: 0 }]) {
        expect(checkSelfDeleteGate({ profile: perfil(role, role === 'cliente' ? null : 'C'), otros })).toEqual({ ok: true, suspenderEmpresa: false })
      }
    }
  })
})

describe('delete-own-account · paridad con delete-user y delete-company (cada función se despliega con lo suyo)', () => {
  it.each(ROLES_CHECK_PRODUCCION)('rol «%s»: isSuperAdminRole e isPrincipalRole coinciden con delete-user (y con delete-company)', (role) => {
    expect(isSuperAdminRole(role)).toBe(superDeleteUser(role))
    expect(isSuperAdminRole(role)).toBe(superDeleteCompany(role))
    expect(isPrincipalRole(role)).toBe(principalDeleteUser(role))
  })

  it.each(['Super_Admin', 'SUPERADMIN', 'super-admin', 'Company_Owner', 'owner', '', ' ', 'null'])('grafía «%s»: tampoco es principal en ninguna de las funciones', (role) => {
    expect(isSuperAdminRole(role)).toBe(false)
    expect(isPrincipalRole(role)).toBe(principalDeleteUser(role))
    expect(isPrincipalRole(role)).toBe(false)
  })

  it('isBenignStripeCancelError e isAuthUserGone espejan los de delete-company', () => {
    for (const msg of ['No such subscription: sub_1', 'Subscription is already canceled', 'card_declined', '', 'timeout']) {
      expect(isBenignStripeCancelError(msg)).toBe(benignDeleteCompany(msg))
    }
    for (const err of [null, undefined, { status: 404 }, { code: 'user_not_found' }, { status: 500 }, { message: 'x' }, { status: 403, code: 'forbidden' }]) {
      expect(isAuthUserGone(err)).toBe(authGoneDeleteCompany(err))
    }
  })
})

describe('delete-own-account · filas de auditoría', () => {
  it('permission_audit_log: action user_deleted (el valor que admite el CHECK desde 20260522000010), actor y objetivo null, identidad en details con self_service', () => {
    const row = buildSelfDeletedAudit(perfil('admin'), false)
    expect(row.action).toBe('user_deleted')
    expect(row.actor_id).toBeNull()
    expect(row.target_user_id).toBeNull()
    expect(row.details).toEqual({
      deleted_user_id: 'u-yo', full_name: 'Yo Mismo', role: 'admin', company_id: 'C', cliente_id: null, self_service: true, company_suspended: false,
    })
    expect(buildSelfDeletedAudit(perfil('company_owner'), true).details).toMatchObject({ company_suspended: true })
    expect(buildSelfDeletedAudit(perfil('cliente', null), false).details).toMatchObject({ cliente_id: 'cl-1', company_id: null })
  })

  it('security_logs: account_deleted con la IP y el user-agent del servidor, también para un login sin perfil', () => {
    const now = new Date('2026-11-04T12:00:00Z')
    const row = buildAccountDeletedSecurityLog({ userId: 'u-yo', profile: null, empresaSuspendida: false, ip: '1.2.3.4', userAgent: 'UA', now })
    expect(row).toEqual({
      user_id: 'u-yo', event_type: 'account_deleted',
      details: { role: null, company_id: null, had_profile: false, company_suspended: false, self_service: true },
      ip_address: '1.2.3.4', user_agent: 'UA', timestamp: '2026-11-04T12:00:00.000Z',
    })
    expect(buildAccountDeletedSecurityLog({ userId: 'u-yo', profile: perfil('company_owner'), empresaSuspendida: true, ip: 'unknown', userAgent: '', now }).details)
      .toEqual({ role: 'company_owner', company_id: 'C', had_profile: true, company_suspended: true, self_service: true })
  })
})
