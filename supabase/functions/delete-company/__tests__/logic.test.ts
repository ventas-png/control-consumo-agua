// Tests de la lógica pura de delete-company (infra:I22 · Track T8/T5). Como el
// resto de tests de edge fns, corre bajo vitest (no Deno) tratando el módulo
// como TS normal. Cubre: gates de confirmación y período de gracia de la purga,
// resolución de días de gracia, clasificación del error de Stripe, partición de
// usuarios (super_admins se desligan, no se purgan) y snapshot de auditoría.

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_GRACE_DAYS,
  buildPurgeAuditBefore,
  checkPurgeGates,
  isBenignStripeCancelError,
  isSuperAdminRole,
  partitionCompanyUsers,
  resolveGraceDays,
  type CompanyRow,
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

  it('un entero válido se respeta; 0 cae al default (|| fallback)', () => {
    expect(resolveGraceDays('45')).toBe(45)
    expect(resolveGraceDays('0')).toBe(90)
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

describe('delete-company/partitionCompanyUsers', () => {
  it('super_admins (ambas grafías) se separan del resto — se desligan, no se purgan', () => {
    const users = [
      { id: 'u1', role: 'super_admin', full_name: 'SA 1' },
      { id: 'u2', role: 'superadmin', full_name: 'SA 2' },
      { id: 'u3', role: 'company_owner', full_name: 'Owner' },
      { id: 'u4', role: 'admin', full_name: 'Admin' },
      { id: 'u5', role: 'cliente', full_name: null },
    ]
    const { superAdmins, deletables } = partitionCompanyUsers(users)
    expect(superAdmins.map(u => u.id)).toEqual(['u1', 'u2'])
    expect(deletables.map(u => u.id)).toEqual(['u3', 'u4', 'u5'])
  })

  it('la partición es total: nadie se pierde ni se duplica', () => {
    const users = [
      { id: 'a', role: 'operador', full_name: null },
      { id: 'b', role: 'superadmin', full_name: null },
    ]
    const { superAdmins, deletables } = partitionCompanyUsers(users)
    expect(superAdmins.length + deletables.length).toBe(users.length)
  })

  it('el company_owner SÍ se purga junto con su empresa', () => {
    const { deletables } = partitionCompanyUsers([{ id: 'o', role: 'company_owner', full_name: 'O' }])
    expect(deletables).toHaveLength(1)
  })

  it('isSuperAdminRole reconoce ambas grafías (gate del caller)', () => {
    expect(isSuperAdminRole('super_admin')).toBe(true)
    expect(isSuperAdminRole('superadmin')).toBe(true)
    expect(isSuperAdminRole('company_owner')).toBe(false)
  })
})

describe('delete-company/buildPurgeAuditBefore', () => {
  const company: CompanyRow = {
    id: 'c-1',
    nombre: 'Residencial Mayan',
    activa: false,
    suspended_at: '2026-03-01T00:00:00.000Z',
    suspended_reason: 'impago',
    logo_url: 'logos/c-1.png',
    created_at: '2025-01-01T00:00:00.000Z',
  }

  it('preserva la fila completa + conteos + parámetros de la purga', () => {
    const before = buildPurgeAuditBefore(company, { projects: 3, unidades: 120, usuarios: 5 }, 90, 'sub_123')
    expect(before).toMatchObject({
      id: 'c-1',
      nombre: 'Residencial Mayan',
      suspended_reason: 'impago',
      deleted_counts: { projects: 3, unidades: 120, usuarios: 5 },
      grace_days: 90,
      stripe_subscription_canceled: 'sub_123',
    })
  })

  it('conteos null (head:true sin filas) → 0, y sin suscripción Stripe queda null', () => {
    const before = buildPurgeAuditBefore(company, { projects: null, unidades: null, usuarios: 0 }, 90, null)
    expect(before.deleted_counts).toEqual({ projects: 0, unidades: 0, usuarios: 0 })
    expect(before.stripe_subscription_canceled).toBeNull()
  })
})
