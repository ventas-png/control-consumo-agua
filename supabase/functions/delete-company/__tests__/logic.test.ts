// Tests de la lógica pura de delete-company (infra:I22 · Track T8/T5). Como el
// resto de tests de edge fns, corre bajo vitest (no Deno) tratando el módulo
// como TS normal. Cubre: gates de confirmación y período de gracia de la purga,
// resolución de días de gracia, validación del cuerpo, clasificación del error
// de Stripe, traducción de los errores de la RPC `purgar_empresa` y lectura de
// su respuesta. Qué se borra y en qué orden lo fija la RPC
// (supabase/tests/purgar_empresa); el handler entero, handler.test.ts.

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_GRACE_DAYS,
  checkPurgeGates,
  isAuthUserGone,
  isBenignStripeCancelError,
  isSuperAdminRole,
  mapPurgeRpcError,
  parsePurgeBody,
  parsePurgeResult,
  resolveGraceDays,
} from '../logic.ts'

const DAY_MS = 24 * 60 * 60 * 1000

// Empresa base suspendida hace 120 días respecto a NOW (elegible con gracia 90).
const NOW = new Date('2026-07-01T12:00:00.000Z')
const base = {
  nombre: 'Residencial Mayan',
  activa: false,
  suspended_at: new Date(NOW.getTime() - 120 * DAY_MS).toISOString(),
}

describe('delete-company/resolveGraceDays', () => {
  it('sin env / vacío / basura → default de 90 días', () => {
    expect(resolveGraceDays(undefined)).toBe(DEFAULT_GRACE_DAYS)
    expect(resolveGraceDays(null)).toBe(90)
    expect(resolveGraceDays('')).toBe(90)
    expect(resolveGraceDays('noventa')).toBe(90)
  })

  it('un entero válido se respeta; 0 cae al default', () => {
    expect(resolveGraceDays('45')).toBe(45)
    expect(resolveGraceDays('0')).toBe(90)
  })

  it('un negativo NO pasa: -5 días harían elegible una empresa suspendida hace un minuto', () => {
    expect(resolveGraceDays('-5')).toBe(90)
    expect(resolveGraceDays('-1')).toBe(90)
  })
})

describe('delete-company/checkPurgeGates', () => {
  it('confirm_name debe coincidir EXACTO (case-sensitive) → 400', () => {
    const gate = checkPurgeGates(base, 'residencial mayan', 90, NOW)
    expect(gate).toEqual({
      ok: false,
      status: 400,
      error: 'El nombre de confirmación no coincide con el nombre de la empresa',
    })
  })

  it('empresa aún activa → 409 (debe suspenderse primero)', () => {
    const gate = checkPurgeGates({ ...base, activa: true }, 'Residencial Mayan', 90, NOW)
    expect(gate).toEqual({
      ok: false,
      status: 409,
      error: 'La empresa debe estar suspendida antes de eliminarse',
    })
  })

  it('el gate de nombre gana al de suspensión (mismo orden que el handler)', () => {
    const gate = checkPurgeGates({ ...base, activa: true }, 'otro nombre', 90, NOW)
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.status).toBe(400)
  })

  it('sin suspended_at → 409 sin fecha elegible en el mensaje', () => {
    const gate = checkPurgeGates({ ...base, suspended_at: null }, 'Residencial Mayan', 90, NOW)
    expect(gate).toEqual({
      ok: false,
      status: 409,
      error: 'La empresa debe llevar al menos 90 días suspendida antes de la purga definitiva',
    })
  })

  it('suspendida hace 30 días con gracia de 90 → 409 con la fecha elegible', () => {
    const suspendedAt = new Date(NOW.getTime() - 30 * DAY_MS) // 2026-06-01
    const gate = checkPurgeGates(
      { ...base, suspended_at: suspendedAt.toISOString() },
      'Residencial Mayan',
      90,
      NOW,
    )
    expect(gate).toEqual({
      ok: false,
      status: 409,
      // 2026-06-01 + 90 días = 2026-08-30
      error: 'La empresa debe llevar al menos 90 días suspendida antes de la purga definitiva (elegible el 2026-08-30)',
    })
  })

  it('en la frontera exacta (gracia cumplida al segundo) la purga procede', () => {
    const suspendedAt = new Date(NOW.getTime() - 90 * DAY_MS)
    expect(checkPurgeGates(
      { ...base, suspended_at: suspendedAt.toISOString() },
      'Residencial Mayan',
      90,
      NOW,
    )).toEqual({ ok: true })
  })

  it('gracia sobradamente cumplida → ok', () => {
    expect(checkPurgeGates(base, 'Residencial Mayan', 90, NOW)).toEqual({ ok: true })
  })

  it('el mensaje refleja los días de gracia configurados', () => {
    const gate = checkPurgeGates({ ...base, suspended_at: null }, 'Residencial Mayan', 30, NOW)
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.error).toContain('al menos 30 días')
  })
})

describe('delete-company/isBenignStripeCancelError', () => {
  it('suscripción ya cancelada o inexistente → benigno (la purga continúa)', () => {
    expect(isBenignStripeCancelError('No such subscription: sub_123')).toBe(true)
    expect(isBenignStripeCancelError('This subscription has been canceled')).toBe(true)
    expect(isBenignStripeCancelError('SUBSCRIPTION ALREADY CANCELED')).toBe(true) // case-insensitive
  })

  it('cualquier otro fallo aborta (no dejar cobros recurrentes huérfanos)', () => {
    expect(isBenignStripeCancelError('rate_limit exceeded')).toBe(false)
    expect(isBenignStripeCancelError('card_declined')).toBe(false)
    expect(isBenignStripeCancelError('')).toBe(false)
  })
})

describe('delete-company/isSuperAdminRole', () => {
  it('reconoce ambas grafías (gate del caller)', () => {
    expect(isSuperAdminRole('super_admin')).toBe(true)
    expect(isSuperAdminRole('superadmin')).toBe(true)
    expect(isSuperAdminRole('company_owner')).toBe(false)
    expect(isSuperAdminRole('')).toBe(false)
  })
})

describe('delete-company/parsePurgeBody', () => {
  const UUID = 'e1000000-0000-4000-8000-000000000001'

  it('objeto válido → company_id y confirm_name recortados', () => {
    expect(parsePurgeBody({ company_id: ` ${UUID} `, confirm_name: ' Residencial Mayan ' }))
      .toEqual({ ok: true, companyId: UUID, confirmName: 'Residencial Mayan' })
  })

  it.each([
    ['null (JSON roto o cuerpo vacío)', null],
    ['un arreglo', [UUID, 'Residencial Mayan']],
    ['un número', 42],
    ['un texto', 'hola'],
  ])('%s → error, no excepción', (_desc, raw) => {
    const r = parsePurgeBody(raw)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/objeto JSON/)
  })

  it('company_id numérico → «debe ser texto» (antes: .trim() de un número → 500)', () => {
    expect(parsePurgeBody({ company_id: 123, confirm_name: 'X' }))
      .toEqual({ ok: false, error: 'company_id debe ser texto' })
  })

  it('confirm_name no texto → «debe ser texto»', () => {
    expect(parsePurgeBody({ company_id: UUID, confirm_name: { a: 1 } }))
      .toEqual({ ok: false, error: 'confirm_name debe ser texto' })
  })

  it('faltan o vienen vacíos → «Faltan company_id o confirm_name»', () => {
    expect(parsePurgeBody({})).toEqual({ ok: false, error: 'Faltan company_id o confirm_name' })
    expect(parsePurgeBody({ company_id: UUID, confirm_name: '   ' }))
      .toEqual({ ok: false, error: 'Faltan company_id o confirm_name' })
  })

  it('company_id que no es UUID → error (no llega a Postgres como 22P02)', () => {
    expect(parsePurgeBody({ company_id: 'no-es-uuid', confirm_name: 'X' }))
      .toEqual({ ok: false, error: 'company_id no es un identificador válido' })
  })
})

describe('delete-company/mapPurgeRpcError', () => {
  it.each([
    ['PURGA_PARAMETROS', 400],
    ['PURGA_NOMBRE_NO_COINCIDE', 400],
    ['PURGA_ACTOR_DE_LA_EMPRESA', 400],
    ['PURGA_SOLO_SUPERADMIN', 403],
    ['PURGA_EMPRESA_NO_ENCONTRADA', 404],
    ['PURGA_EMPRESA_ACTIVA', 409],
    ['PURGA_EN_GRACIA', 409],
  ])('%s → %i', (prefijo, status) => {
    const r = mapPurgeRpcError({ code: 'P0001', message: `${prefijo}: detalle de la base.` })
    expect(r.status).toBe(status)
  })

  it('el detalle sale sin el prefijo técnico', () => {
    expect(mapPurgeRpcError({ code: '55000', message: 'PURGA_EN_GRACIA: la empresa debe llevar al menos 90 días.' }))
      .toEqual({ status: 409, error: 'la empresa debe llevar al menos 90 días.' })
  })

  it('una FK que no se pudo despejar (23503) → 409 nombrando la tabla, «no se borró nada»', () => {
    const r = mapPurgeRpcError({
      code: '23503',
      message: 'update or delete on table "companies" violates foreign key constraint "x_fkey" on table "x"',
    })
    expect(r.status).toBe(409)
    expect(r.error).toContain('x_fkey')
    expect(r.error).toContain('No se borró nada')
  })

  it('un guard de inmutabilidad (23514) → 409 con su mensaje', () => {
    const r = mapPurgeRpcError({ code: '23514', message: 'BITACORA_INMUTABLE: pasarela_eventos sólo admite inserciones.' })
    expect(r.status).toBe(409)
    expect(r.error).toContain('BITACORA_INMUTABLE')
  })

  it('cualquier otro error → 500 genérico, sin filtrar el mensaje de Postgres', () => {
    const r = mapPurgeRpcError({ code: 'XX000', message: 'internal: secreto' })
    expect(r.status).toBe(500)
    expect(r.error).not.toContain('secreto')
  })

  it('sin mensaje ni código → 500', () => {
    expect(mapPurgeRpcError({}).status).toBe(500)
  })
})

describe('delete-company/parsePurgeResult', () => {
  const ok = {
    company_id: 'c-1', nombre: 'X', logo_url: 'logos/x.png', usuarios_auth: ['u1', 'u2'],
    personas: 1, cuentas_cliente: 1, clientes: 2, proyectos: 2, unidades: 3, superadmins_desligados: 1,
  }

  it('respuesta completa → se lee tal cual', () => {
    expect(parsePurgeResult(ok)).toEqual(ok)
  })

  it('sin usuarios_auth, o con algo que no es texto → null (el handler lo dice, no adivina)', () => {
    expect(parsePurgeResult({ ...ok, usuarios_auth: undefined })).toBeNull()
    expect(parsePurgeResult({ ...ok, usuarios_auth: [1] })).toBeNull()
    expect(parsePurgeResult(null)).toBeNull()
    expect(parsePurgeResult([ok])).toBeNull()
  })

  it('logo vacío → null; conteos ausentes → 0', () => {
    const r = parsePurgeResult({ company_id: 'c', nombre: 'n', logo_url: '', usuarios_auth: [] })
    expect(r).toMatchObject({ logo_url: null, personas: 0, proyectos: 0 })
  })
})

describe('delete-company/isAuthUserGone', () => {
  it('404 o user_not_found → ya no existe: la purga es idempotente', () => {
    expect(isAuthUserGone({ status: 404 })).toBe(true)
    expect(isAuthUserGone({ code: 'user_not_found' })).toBe(true)
  })

  it('cualquier otro fallo o ningún error → false', () => {
    expect(isAuthUserGone({ status: 500 })).toBe(false)
    expect(isAuthUserGone(null)).toBe(false)
  })
})
