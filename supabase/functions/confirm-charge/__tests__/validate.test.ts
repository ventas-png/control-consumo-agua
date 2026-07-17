// B6 — Validación estricta del body de confirm-charge.
import { describe, it, expect } from 'vitest'
import { validarConfirmChargeBody } from '../validate'

const UUID = '123e4567-e89b-42d3-a456-426614174000'

describe('validarConfirmChargeBody', () => {
  it('payment_request_id UUID válido → ok', () => {
    const r = validarConfirmChargeBody({ payment_request_id: UUID })
    expect(r).toEqual({ ok: true, body: { payment_request_id: UUID } })
  })

  it('ausente, no-string o malformado → rechazado', () => {
    for (const bad of [{}, { payment_request_id: null }, { payment_request_id: 42 }, { payment_request_id: 'abc' }]) {
      expect(validarConfirmChargeBody(bad).ok).toBe(false)
    }
  })

  it('no-objeto → rechazado', () => {
    for (const bad of [null, 'x', [UUID]]) {
      expect(validarConfirmChargeBody(bad).ok).toBe(false)
    }
  })
})
