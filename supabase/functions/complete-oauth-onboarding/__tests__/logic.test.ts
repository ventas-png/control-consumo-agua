// Tests de la lógica pura de complete-oauth-onboarding (infra:I22 · Track
// T8/T5). Como el resto de tests de edge fns, corre bajo vitest (no Deno)
// tratando el módulo como TS normal. Cubre: resolución del nombre desde la
// metadata de Google, match de identidad 3-de-3 anti-enumeración y fila de
// perfil (rol SIEMPRE 'cliente').

import { describe, it, expect } from 'vitest'
import {
  IDENTITY_ERROR,
  buildClienteProfileRow,
  chooseFullName,
  isIdentityMatch,
  isPrivateRelayEmail,
  resolveFullName,
  resolveLookupEmail,
} from '../logic.ts'

describe('complete-oauth-onboarding/resolveFullName', () => {
  it('full_name de la metadata gana sobre name y email', () => {
    expect(resolveFullName({ full_name: 'Ana García', name: 'Ana' }, 'ana@g.com')).toBe('Ana García')
  })

  it('sin full_name cae a name; sin metadata útil cae al email', () => {
    expect(resolveFullName({ name: 'Ana' }, 'ana@g.com')).toBe('Ana')
    expect(resolveFullName({}, 'ana@g.com')).toBe('ana@g.com')
    expect(resolveFullName(null, 'ana@g.com')).toBe('ana@g.com')
    expect(resolveFullName(undefined, 'ana@g.com')).toBe('ana@g.com')
  })

  it('una cadena vacía en full_name NO cae al fallback (?? solo salta null/undefined)', () => {
    expect(resolveFullName({ full_name: '', name: 'Ana' }, 'ana@g.com')).toBe('')
  })
})

// Sign in with Apple: el nombre llega solo en la primera autorización (GoTrue lo
// guarda en full_name) y, con «Ocultar mi correo», el JWT trae un alias
// @privaterelay.appleid.com que nunca casa con el padrón.
describe('complete-oauth-onboarding/chooseFullName', () => {
  it('la metadata del proveedor manda aunque el formulario traiga otro nombre', () => {
    expect(chooseFullName({ full_name: 'Ana García' }, 'ana@g.com', 'Otro Nombre')).toBe('Ana García')
  })

  it('sin nombre en la metadata, usa el declarado (recortado y acotado)', () => {
    expect(chooseFullName({}, 'ana@g.com', '  Ana García  ')).toBe('Ana García')
    expect(chooseFullName(null, 'x@privaterelay.appleid.com', 'A'.repeat(200))).toHaveLength(120)
  })

  it('sin metadata ni declarado, conserva el comportamiento previo (email o vacío)', () => {
    expect(chooseFullName({}, 'ana@g.com', undefined)).toBe('ana@g.com')
    expect(chooseFullName({}, 'ana@g.com', '   ')).toBe('ana@g.com')
    expect(chooseFullName({ full_name: '' }, 'ana@g.com', null)).toBe('')
  })
})

describe('complete-oauth-onboarding/isPrivateRelayEmail · resolveLookupEmail', () => {
  it('detecta el alias de Apple sin importar mayúsculas ni espacios', () => {
    expect(isPrivateRelayEmail('abc123@privaterelay.appleid.com')).toBe(true)
    expect(isPrivateRelayEmail('  ABC@PrivateRelay.AppleID.com ')).toBe(true)
    expect(isPrivateRelayEmail('ana@gmail.com')).toBe(false)
    expect(isPrivateRelayEmail('ana@privaterelay.appleid.com.evil.io')).toBe(false)
    expect(isPrivateRelayEmail(null)).toBe(false)
  })

  it('con un correo normal en el JWT, el declarado se IGNORA (no se puede suplantar el padrón)', () => {
    expect(resolveLookupEmail('ana@gmail.com', 'otra@empresa.com')).toBe('ana@gmail.com')
  })

  it('con alias de Apple, busca por el correo declarado (normalizado)', () => {
    expect(resolveLookupEmail('abc@privaterelay.appleid.com', '  Ana@Empresa.com ')).toBe('ana@empresa.com')
  })

  it('con alias de Apple y declarado inválido o ausente, cae al alias (→ IDENTITY_ERROR río abajo)', () => {
    expect(resolveLookupEmail('abc@privaterelay.appleid.com', 'no-es-correo')).toBe('abc@privaterelay.appleid.com')
    expect(resolveLookupEmail('abc@privaterelay.appleid.com', undefined)).toBe('abc@privaterelay.appleid.com')
  })
})

describe('complete-oauth-onboarding/isIdentityMatch · IDENTITY_ERROR', () => {
  it('solo match 3-de-3 (email del JWT + DPI + fecha) con cliente_id cuenta', () => {
    expect(isIdentityMatch({ match_count: 3, cliente_id: 'cl-1' })).toBe(true)
    expect(isIdentityMatch({ match_count: 2, cliente_id: 'cl-1' })).toBe(false)
    expect(isIdentityMatch({ match_count: 3, cliente_id: null })).toBe(false)
    expect(isIdentityMatch({ match_count: 0, cliente_id: null })).toBe(false)
  })

  it('el error genérico no revela qué campo falló (anti-enumeración)', () => {
    expect(IDENTITY_ERROR).toBe('No se encontró un cliente con los datos proporcionados. Verifique su DPI/CUI y fecha de nacimiento.')
  })
})

describe('complete-oauth-onboarding/buildClienteProfileRow', () => {
  it('el rol es SIEMPRE cliente y la cuenta nace activa (sin escalada posible)', () => {
    const row = buildClienteProfileRow('oauth-u1', ' Ana García ', 'cl-7')
    expect(row).toEqual({
      id: 'oauth-u1',
      full_name: 'Ana García', // trim aplicado
      role: 'cliente',
      cliente_id: 'cl-7',
      activo: true,
    })
  })
})
