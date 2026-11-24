// Lógica pura de update-user: quién edita a quién, qué campos son válidos, qué cuenta como cambio y qué se audita.
import { describe, it, expect } from 'vitest'
import {
  buildUserUpdatedAudit, cambiosEfectivos, checkEditTargetGate, EDITABLE_ROLES, isPrincipalRole, isTextOrAbsent, mensajeErrorAuth,
  MSG_SOLO_PRINCIPAL_EDITAR, normalizeEmail, parseCambios,
} from '../validate.ts'
import { DELETABLE_ROLES, isTextOrAbsent as isTextOrAbsentDelete, isPrincipalRole as principalDelete } from '../../delete-user/validate.ts'

const objetivo = (role: string, company_id: string | null = 'C') => ({ role, company_id })

describe('checkEditTargetGate', () => {
  it.each(['super_admin', 'superadmin'])('%s edita a cualquiera, de cualquier empresa y con cualquier rol', rol => {
    expect(checkEditTargetGate({ callerRole: rol, callerCompanyId: null, target: objetivo('company_owner', 'OTRA') })).toEqual({ ok: true })
  })

  it.each(EDITABLE_ROLES)('el propietario edita a «%s» de su empresa', rol => {
    expect(checkEditTargetGate({ callerRole: 'company_owner', callerCompanyId: 'C', target: objetivo(rol) })).toEqual({ ok: true })
  })

  it.each(['company_owner', 'super_admin', 'superadmin', 'cliente', 'user', ''])('el propietario NO edita a «%s»', rol => {
    expect(checkEditTargetGate({ callerRole: 'company_owner', callerCompanyId: 'C', target: objetivo(rol) }))
      .toEqual({ ok: false, error: 'No tienes permiso para editar a este usuario' })
  })

  it('el propietario NO edita a nadie de otra empresa (el check de empresa va antes que el de rol)', () => {
    expect(checkEditTargetGate({ callerRole: 'company_owner', callerCompanyId: 'C', target: objetivo('company_owner', 'OTRA') }))
      .toEqual({ ok: false, error: 'No puedes editar usuarios de otra empresa' })
  })

  it.each([null, ''])('un propietario SIN empresa (%j) no edita a nadie, tampoco a alguien sin empresa (null === null no pasa)', empresa => {
    expect(checkEditTargetGate({ callerRole: 'company_owner', callerCompanyId: empresa, target: objetivo('operator', null) }).ok).toBe(false)
  })

  it.each(['admin', 'operator', 'operador', 'viewer', 'visor', 'collector', 'cliente', 'user', '', 'Company_Owner'])(
    'quien no es el principal («%s») no edita a nadie, ni a un operador de su empresa', rol => {
      expect(checkEditTargetGate({ callerRole: rol, callerCompanyId: 'C', target: objetivo('operator') }))
        .toEqual({ ok: false, error: MSG_SOLO_PRINCIPAL_EDITAR })
    })
})

describe('paridad con delete-user', () => {
  it('los roles editables son los eliminables, y el principal y isTextOrAbsent coinciden', () => {
    expect(EDITABLE_ROLES).toEqual(DELETABLE_ROLES)
    for (const rol of ['super_admin', 'superadmin', 'company_owner', 'admin', 'operator', '']) expect(isPrincipalRole(rol)).toBe(principalDelete(rol))
    for (const v of [undefined, null, '', 'x', 1, [], {}, true]) expect(isTextOrAbsent(v)).toBe(isTextOrAbsentDelete(v))
  })
})

describe('parseCambios', () => {
  it('sin campos (o en null) no hay cambios', () => {
    expect(parseCambios({})).toEqual({ ok: true, cambios: {} })
    expect(parseCambios({ full_name: null, email: null, password: null })).toEqual({ ok: true, cambios: {} })
  })

  it('recorta el nombre, normaliza el correo y NO recorta la contraseña', () => {
    expect(parseCambios({ full_name: '  Ana López ', email: '  Ana@Ejemplo.COM ', password: ' con espacios ' }))
      .toEqual({ ok: true, cambios: { full_name: 'Ana López', email: 'ana@ejemplo.com', password: ' con espacios ' } })
  })

  it.each([
    [{ full_name: '   ' }, /nombre/i],
    [{ full_name: 'x'.repeat(121) }, /120/],
    [{ email: '' }, /correo/i],
    [{ email: 'sin-arroba' }, /correo/i],
    [{ email: 'a@b' }, /correo/i],
    [{ email: 'a b@c.com' }, /correo/i],
    [{ password: '' }, /8 caracteres/],
    [{ password: '1234567' }, /8 caracteres/],
  ])('un campo presente pero inválido es un error: %j', (body, motivo) => {
    const r = parseCambios(body)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(motivo)
  })
})

describe('cambiosEfectivos', () => {
  const actual = { full_name: 'Ana', email: 'Ana@X.com' }
  it('descarta el nombre y el correo que ya valen lo mismo (el correo, sin distinguir mayúsculas)', () => {
    expect(cambiosEfectivos({ full_name: 'Ana', email: 'ana@x.com' }, actual)).toEqual({})
  })
  it('conserva lo que sí cambia, y la contraseña siempre', () => {
    expect(cambiosEfectivos({ full_name: 'Ana María', email: 'ana@x.com', password: '12345678' }, actual))
      .toEqual({ full_name: 'Ana María', password: '12345678' })
    expect(cambiosEfectivos({ email: 'otra@x.com' }, { full_name: 'Ana', email: null })).toEqual({ email: 'otra@x.com' })
  })
})

describe('buildUserUpdatedAudit', () => {
  const target = { id: 'u1', role: 'operator', company_id: 'C', full_name: 'Ana' }
  it('registra antes y después del nombre y del correo, y NUNCA la contraseña', () => {
    const fila = buildUserUpdatedAudit('actor', target, 'ana@x.com', { full_name: 'Ana María', email: 'am@x.com', password: 'secreta-123' })
    expect(fila).toEqual({
      actor_id: 'actor', target_user_id: 'u1', action: 'user_updated',
      details: {
        changed: ['full_name', 'email', 'password'], company_id: 'C',
        full_name_before: 'Ana', full_name_after: 'Ana María', email_before: 'ana@x.com', email_after: 'am@x.com',
      },
    })
    expect(JSON.stringify(fila)).not.toContain('secreta-123')
  })
  it('sólo contraseña: sólo dice que se cambió', () => {
    expect(buildUserUpdatedAudit('actor', target, 'ana@x.com', { password: 'secreta-123' }).details).toEqual({ changed: ['password'], company_id: 'C' })
  })
})

describe('mensajeErrorAuth / normalizeEmail', () => {
  it('correo en uso → mensaje claro', () => {
    expect(mensajeErrorAuth('A user with this email address has already been registered')).toBe('Ese correo ya está en uso por otra cuenta.')
  })
  it('contraseña rechazada y error desconocido', () => {
    expect(mensajeErrorAuth('Password is known to be weak')).toMatch(/requisitos de seguridad/)
    expect(mensajeErrorAuth(null)).toMatch(/error desconocido/)
  })
  it('normalizeEmail', () => { expect(normalizeEmail('  A@B.Com ')).toBe('a@b.com'); expect(normalizeEmail(null)).toBe('') })
})
