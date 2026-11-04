// Tests de la lógica pura de create-cliente-account. Como el resto de tests de
// edge fns, corre bajo vitest (no Deno) tratando el módulo como TS normal.
// Cubre: el error genérico de identidad (anti-enumeración, pero accionable para
// quien YA tiene cuenta), el match 3-de-3 y la clasificación del error de
// auth.admin.createUser (contraseña débil/filtrada vs correo duplicado vs otro).

import { describe, it, expect } from 'vitest'
import {
  DUPLICATE_EMAIL_ERROR,
  GENERIC_CREATE_ERROR,
  IDENTITY_ERROR,
  classifyAuthCreateError,
  isIdentityMatch,
} from '../logic.ts'

describe('create-cliente-account/IDENTITY_ERROR', () => {
  it('no revela qué campo falló ni si el cliente existe (anti-enumeración)', () => {
    expect(IDENTITY_ERROR).toMatch(/^No se encontró un cliente con los datos proporcionados/)
    expect(IDENTITY_ERROR).not.toMatch(/incorrect|inválid/i)
  })

  it('cubre el caso «ya tiene cuenta» y dice qué hacer: es el mismo mensaje para ambos', () => {
    // 2026-11-03: residente con cuenta creada vía Google recibía solo «no se
    // encontró un cliente» con los datos correctos.
    expect(IDENTITY_ERROR).toContain('ya tiene una cuenta en el portal')
    expect(IDENTITY_ERROR).toContain('Continuar con Google')
    expect(IDENTITY_ERROR).toContain('¿Olvidaste tu contraseña?')
    expect(IDENTITY_ERROR).toContain('DPI/CUI, fecha de nacimiento y correo electrónico')
  })
})

describe('create-cliente-account/isIdentityMatch', () => {
  it('solo match 3-de-3 con cliente_id cuenta', () => {
    expect(isIdentityMatch({ match_count: 3, cliente_id: 'cl-1' })).toBe(true)
    expect(isIdentityMatch({ match_count: 2, cliente_id: 'cl-1' })).toBe(false)
    expect(isIdentityMatch({ match_count: 3, cliente_id: null })).toBe(false)
    expect(isIdentityMatch({ match_count: 0, cliente_id: null })).toBe(false)
  })

  it('un resultado ausente es no-match, no excepción', () => {
    expect(isIdentityMatch(null)).toBe(false)
    expect(isIdentityMatch(undefined)).toBe(false)
  })
})

describe('create-cliente-account/classifyAuthCreateError', () => {
  it('weak_password con reasons=["pwned"] (el caso real del 2026-11-03) explica que la contraseña está filtrada', () => {
    const r = classifyAuthCreateError({
      name: 'AuthWeakPasswordError',
      message: 'Password is known to be weak and easy to guess, please choose a different one.',
      status: 422,
      code: 'weak_password',
      reasons: ['pwned'],
    })
    expect(r.kind).toBe('weak_password')
    expect(r.message).toBe(
      'La contraseña es demasiado común o apareció en filtraciones de datos conocidas. ' +
      'Elija una contraseña distinta, que no use en otros sitios.',
    )
  })

  it('weak_password por política (length + characters) enumera los motivos', () => {
    const r = classifyAuthCreateError({ code: 'weak_password', message: 'Password should be at least 8 characters.', reasons: ['length', 'characters'] })
    expect(r.kind).toBe('weak_password')
    expect(r.message).toContain('es demasiado corta y no incluye los tipos de caracteres requeridos')
  })

  it('weak_password sin reasons (o con uno desconocido) cae a un motivo genérico, nunca al mensaje de «intente nuevamente»', () => {
    expect(classifyAuthCreateError({ code: 'weak_password', message: 'x' }).message).toContain('es demasiado fácil de adivinar')
    expect(classifyAuthCreateError({ code: 'weak_password', reasons: ['algo_nuevo'] }).message).toContain('es demasiado fácil de adivinar')
    // Solo por nombre de clase, sin code (auth-js viejo serializado)
    expect(classifyAuthCreateError({ name: 'AuthWeakPasswordError', message: 'weak' }).kind).toBe('weak_password')
  })

  it('correo duplicado: por mensaje («already») o por code email_exists', () => {
    expect(classifyAuthCreateError({ message: 'A user with this email address has already been registered' }))
      .toEqual({ kind: 'duplicate', message: DUPLICATE_EMAIL_ERROR })
    expect(classifyAuthCreateError({ code: 'email_exists', message: 'Email address already exists' }).kind).toBe('duplicate')
    expect(classifyAuthCreateError({ code: 'email_exists', message: 'x' }).kind).toBe('duplicate')
  })

  it('cualquier otro error (o ninguno) → mensaje genérico de reintento', () => {
    expect(classifyAuthCreateError({ message: 'Database error creating new user' }))
      .toEqual({ kind: 'other', message: GENERIC_CREATE_ERROR })
    expect(classifyAuthCreateError(null)).toEqual({ kind: 'other', message: GENERIC_CREATE_ERROR })
    expect(classifyAuthCreateError(undefined).kind).toBe('other')
  })
})
