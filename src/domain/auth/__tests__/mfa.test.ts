// T7/plat:P13 — Tests de las decisiones PURAS del segundo factor (TOTP),
// extraídas de useAuth. Cubren lógica sensible de seguridad sin tocar red/React.
import { describe, it, expect } from 'vitest'
import {
  needsTotpStepUp,
  findVerifiedTotpFactor,
  isValidTotpCode,
  classifyMfaVerifyError,
} from '../mfa'

describe('needsTotpStepUp', () => {
  it('aal1 → aal2 requerido → true', () => {
    expect(needsTotpStepUp({ error: null, data: { currentLevel: 'aal1', nextLevel: 'aal2' } })).toBe(true)
  })
  it('ya en aal2 (next == current) → false', () => {
    expect(needsTotpStepUp({ error: null, data: { currentLevel: 'aal2', nextLevel: 'aal2' } })).toBe(false)
  })
  it('sin factores (next aal1) → false', () => {
    expect(needsTotpStepUp({ error: null, data: { currentLevel: 'aal1', nextLevel: 'aal1' } })).toBe(false)
  })
  it('error o data nula → false (no bloquea el login por un fallo del check)', () => {
    expect(needsTotpStepUp({ error: { message: 'x' }, data: { currentLevel: 'aal1', nextLevel: 'aal2' } })).toBe(false)
    expect(needsTotpStepUp({ error: null, data: null })).toBe(false)
    expect(needsTotpStepUp({})).toBe(false)
  })
})

describe('findVerifiedTotpFactor', () => {
  it('prefiere totp[0]', () => {
    expect(findVerifiedTotpFactor({ totp: [{ id: 't1' }], all: [{ id: 'x' }] })).toEqual({ id: 't1' })
  })
  it('si no hay totp, busca en all un totp verificado', () => {
    expect(
      findVerifiedTotpFactor({
        all: [
          { id: 'p1', factor_type: 'phone', status: 'verified' },
          { id: 't2', factor_type: 'totp', status: 'verified' },
        ],
      }),
    ).toEqual({ id: 't2', factor_type: 'totp', status: 'verified' })
  })
  it('descarta totp no verificado en all', () => {
    expect(
      findVerifiedTotpFactor({ all: [{ id: 't3', factor_type: 'totp', status: 'unverified' }] }),
    ).toBeNull()
  })
  it('data vacía / null / undefined → null', () => {
    expect(findVerifiedTotpFactor({})).toBeNull()
    expect(findVerifiedTotpFactor(null)).toBeNull()
    expect(findVerifiedTotpFactor(undefined)).toBeNull()
  })
})

describe('isValidTotpCode', () => {
  it('6 dígitos (con espacios alrededor) → true', () => {
    expect(isValidTotpCode('123456')).toBe(true)
    expect(isValidTotpCode('  000000 ')).toBe(true)
  })
  it('longitud incorrecta o no-dígitos → false', () => {
    for (const bad of ['12345', '1234567', '12 456', 'abcdef', '', '12345a']) {
      expect(isValidTotpCode(bad), bad).toBe(false)
    }
  })
})

describe('classifyMfaVerifyError', () => {
  it('códigos inválidos/expirados → mensaje amigable', () => {
    for (const m of ['Invalid TOTP code', 'verification failed', 'totp mismatch']) {
      expect(classifyMfaVerifyError(m)).toMatch(/Código incorrecto o expirado/)
    }
  })
  it('otro error → lo expone con prefijo', () => {
    expect(classifyMfaVerifyError('Network down')).toBe('Error: Network down')
  })
  it('sin mensaje → genérico', () => {
    expect(classifyMfaVerifyError(null)).toBe('No fue posible verificar el código.')
    expect(classifyMfaVerifyError('')).toBe('No fue posible verificar el código.')
  })
})
