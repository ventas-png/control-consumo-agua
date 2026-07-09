// Tests de la lógica pura de create-cliente-account (infra:I22 · Track T8/T5).
// Como el resto de tests de edge fns, corre bajo vitest (no Deno) tratando el
// módulo como TS normal. Cubre: validación de entrada (campos, click-wrap,
// contraseña), match de identidad 3-de-3 anti-enumeración, mapeo del error de
// Auth, fila de perfil (rol SIEMPRE 'cliente') y evidencia legal.

import { describe, it, expect } from 'vitest'
import {
  IDENTITY_ERROR,
  buildClienteProfileRow,
  buildLegalAcceptanceRows,
  isIdentityMatch,
  mapAuthCreateError,
  normalizeEmail,
  validateSignupInput,
} from '../logic.ts'

const validBody = {
  full_name: 'María López',
  email: 'maria@correo.com',
  cui_dui: '1234567890101',
  fecha_nacimiento: '1990-05-04',
  password: 'segura-123',
  legal_accepted: true,
}

describe('create-cliente-account/validateSignupInput', () => {
  it('entrada completa y consentida → ok', () => {
    expect(validateSignupInput(validBody)).toEqual({ ok: true })
  })

  it('cualquier campo faltante → error de requeridos', () => {
    for (const k of ['full_name', 'email', 'cui_dui', 'fecha_nacimiento', 'password'] as const) {
      expect(validateSignupInput({ ...validBody, [k]: '' }))
        .toEqual({ ok: false, error: 'Todos los campos son requeridos.' })
      expect(validateSignupInput({ ...validBody, [k]: undefined }))
        .toEqual({ ok: false, error: 'Todos los campos son requeridos.' })
    }
  })

  it('click-wrap: legal_accepted debe ser true LITERAL (ni truthy ni string)', () => {
    const legalError = 'Debes aceptar los Términos de Servicio, la Política de Privacidad y el Anexo DPA.'
    expect(validateSignupInput({ ...validBody, legal_accepted: false })).toEqual({ ok: false, error: legalError })
    expect(validateSignupInput({ ...validBody, legal_accepted: undefined })).toEqual({ ok: false, error: legalError })
    // Un cliente malicioso mandando 'true' (string) no pasa el gate.
    expect(validateSignupInput({ ...validBody, legal_accepted: 'true' as unknown as boolean }))
      .toEqual({ ok: false, error: legalError })
  })

  it('contraseña de menos de 8 caracteres → error; 8 exactos pasa', () => {
    expect(validateSignupInput({ ...validBody, password: '1234567' }))
      .toEqual({ ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' })
    expect(validateSignupInput({ ...validBody, password: '12345678' })).toEqual({ ok: true })
  })

  it('el orden de los checks es el del handler: requeridos antes que click-wrap', () => {
    expect(validateSignupInput({ ...validBody, password: undefined, legal_accepted: false }))
      .toEqual({ ok: false, error: 'Todos los campos son requeridos.' })
  })
})

describe('create-cliente-account/isIdentityMatch · IDENTITY_ERROR', () => {
  it('solo match 3-de-3 con cliente_id presente cuenta como identidad verificada', () => {
    expect(isIdentityMatch({ match_count: 3, cliente_id: 'cl-1' })).toBe(true)
  })

  it('matches parciales o sin cliente_id → no verificado (mismo error genérico)', () => {
    expect(isIdentityMatch({ match_count: 2, cliente_id: 'cl-1' })).toBe(false)
    expect(isIdentityMatch({ match_count: 0, cliente_id: null })).toBe(false)
    expect(isIdentityMatch({ match_count: 3, cliente_id: null })).toBe(false)
  })

  it('el error genérico no revela qué campo falló (anti-enumeración)', () => {
    expect(IDENTITY_ERROR).toBe('No se encontró un cliente con los datos proporcionados. Verifique su DPI/CUI, fecha de nacimiento y correo electrónico.')
  })
})

describe('create-cliente-account/normalizeEmail', () => {
  it('minúsculas + trim, igual que el login', () => {
    expect(normalizeEmail('  Maria@Correo.COM ')).toBe('maria@correo.com')
  })
})

describe('create-cliente-account/mapAuthCreateError', () => {
  it('email ya registrado → mensaje específico (substring literal "already registered")', () => {
    expect(mapAuthCreateError('User already registered'))
      .toBe('El correo electrónico ya está registrado.')
    // Ojo: la variante de GoTrue admin "has already been registered" NO contiene
    // el substring literal y cae al genérico — comportamiento actual del handler.
    expect(mapAuthCreateError('A user with this email address has already been registered'))
      .toBe('No se pudo crear la cuenta. Intente nuevamente.')
  })

  it('cualquier otro fallo colapsa en el genérico (no filtrar detalles internos)', () => {
    expect(mapAuthCreateError('Database error saving new user'))
      .toBe('No se pudo crear la cuenta. Intente nuevamente.')
    expect(mapAuthCreateError(undefined))
      .toBe('No se pudo crear la cuenta. Intente nuevamente.')
  })
})

describe('create-cliente-account/buildClienteProfileRow', () => {
  it('el rol es SIEMPRE cliente y la cuenta nace activa (sin escalada posible)', () => {
    const row = buildClienteProfileRow('u-9', '  María López ', 'cl-1')
    expect(row).toEqual({
      id: 'u-9',
      full_name: 'María López', // trim aplicado
      role: 'cliente',
      cliente_id: 'cl-1',
      activo: true,
    })
  })
})

describe('create-cliente-account/buildLegalAcceptanceRows', () => {
  const ctx = {
    userId: 'u-9',
    acceptedAt: '2026-07-01T10:00:00.000Z',
    clientIp: '187.180.10.5',
    userAgent: 'Mozilla/5.0',
  }

  it('una fila por documento vigente, con company_id null y locale es', () => {
    const rows = buildLegalAcceptanceRows(
      [{ doc_type: 'tos', version: '2.1' }, { doc_type: 'privacy', version: '1.4' }],
      ctx,
    )
    expect(rows).toEqual([
      {
        user_id: 'u-9', company_id: null, doc_type: 'tos', version: '2.1', locale: 'es',
        accepted_at: '2026-07-01T10:00:00.000Z', client_ip: '187.180.10.5', user_agent: 'Mozilla/5.0',
      },
      {
        user_id: 'u-9', company_id: null, doc_type: 'privacy', version: '1.4', locale: 'es',
        accepted_at: '2026-07-01T10:00:00.000Z', client_ip: '187.180.10.5', user_agent: 'Mozilla/5.0',
      },
    ])
  })

  it('sin documentos vigentes → sin filas (el handler ya logueó el faltante)', () => {
    expect(buildLegalAcceptanceRows([], ctx)).toEqual([])
  })

  it('user-agent ausente se conserva como null (evidencia fiel)', () => {
    const rows = buildLegalAcceptanceRows([{ doc_type: 'tos', version: '1.0' }], { ...ctx, userAgent: null })
    expect(rows[0].user_agent).toBeNull()
  })
})
