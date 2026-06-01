// Tests del clasificador retriable de F2.15e. Pura — no requiere Deno runtime
// completo, solo el motor de regex.
//
// Importa con .ts explicito porque el resto del codebase (vitest) interpreta
// el modulo como Deno-flavored TS. El test runner de la app usa vitest, que
// trata estos archivos como TS normal.

import { describe, it, expect } from 'vitest'
import { isRetriable } from '../emailRetryable.ts'

describe('isRetriable', () => {
  it('marca 429 como retriable', () => {
    expect(isRetriable('Gmail API: {"error":{"code":429,"message":"Too Many Requests"}}')).toBe(true)
  })

  it('marca 5xx como retriable', () => {
    expect(isRetriable('Gmail API: 503 Service Unavailable')).toBe(true)
    expect(isRetriable('Gmail API: 500')).toBe(true)
  })

  it('marca network errors como retriable', () => {
    expect(isRetriable('Failed to fetch')).toBe(true)
    expect(isRetriable('ECONNRESET')).toBe(true)
    expect(isRetriable('request timeout')).toBe(true)
  })

  it('marca 401/403 (token revoked) como permanente', () => {
    expect(isRetriable('Gmail API: 401 Unauthorized')).toBe(false)
    expect(isRetriable('Gmail API: 403 Forbidden')).toBe(false)
  })

  it('marca invalid_grant como permanente', () => {
    expect(isRetriable('{"error":"invalid_grant","error_description":"Token has been expired or revoked."}')).toBe(false)
  })

  it('marca 400 como permanente', () => {
    expect(isRetriable('Gmail API: 400 Bad Request')).toBe(false)
  })

  it('permanent gana cuando coexisten patrones (e.g. 401 + timeout)', () => {
    expect(isRetriable('Gmail API: 401 — request timeout')).toBe(false)
  })

  it('default conservador: errores desconocidos cuentan como retriable', () => {
    expect(isRetriable('something weird happened')).toBe(true)
  })

  it('string vacio NO retriable (nada que reintentar)', () => {
    expect(isRetriable('')).toBe(false)
  })
})
