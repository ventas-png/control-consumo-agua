// B6 — Validación estricta del body de create-charge (dinero: rechazar
// malformado ANTES de tocar la BD).
import { describe, it, expect } from 'vitest'
import { validarCreateChargeBody } from '../validate'

const UUID = '123e4567-e89b-42d3-a456-426614174000'
const UUID2 = '223e4567-e89b-42d3-a456-426614174000'

describe('validarCreateChargeBody', () => {
  it('body mínimo válido: solo registro_id', () => {
    const r = validarCreateChargeBody({ registro_id: UUID })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.body.registro_id).toBe(UUID)
  })

  it('body mínimo válido: solo cuota_id + monto y urls', () => {
    const r = validarCreateChargeBody({
      cuota_id: UUID, monto: 150.5,
      url_retorno: 'https://app.example.com/pago?ok=1',
      descripcion: 'Cuota julio',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.body.monto).toBe(150.5)
      expect(r.body.url_retorno).toContain('https://')
    }
  })

  it('no-objeto / array / null → rechazado', () => {
    for (const bad of [null, 'x', 42, [UUID]]) {
      const r = validarCreateChargeBody(bad)
      expect(r.ok).toBe(false)
    }
  })

  it('sin ítem a pagar (ni cuota ni registro) → rechazado', () => {
    const r = validarCreateChargeBody({ monto: 10 })
    expect(r).toEqual({ ok: false, error: 'se requiere cuota_id o registro_id' })
  })

  it('cuota_id y registro_id juntos → rechazado (excluyentes)', () => {
    const r = validarCreateChargeBody({ cuota_id: UUID, registro_id: UUID2 })
    expect(r.ok).toBe(false)
  })

  it('UUIDs malformados → rechazado con campo en el mensaje', () => {
    const r = validarCreateChargeBody({ cuota_id: 'DROP TABLE pagos' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('cuota_id')
  })

  it('monto: negativo, NaN, Infinity, string y fuera de rango → rechazados', () => {
    for (const monto of [-1, NaN, Infinity, '100', 10_000_001]) {
      const r = validarCreateChargeBody({ registro_id: UUID, monto })
      expect(r.ok).toBe(false)
    }
  })

  it('monto 0 es válido (= saldo completo, contrato del handler)', () => {
    const r = validarCreateChargeBody({ registro_id: UUID, monto: 0 })
    expect(r.ok).toBe(true)
  })

  it('ambiente fuera de sandbox/prod → rechazado', () => {
    expect(validarCreateChargeBody({ registro_id: UUID, ambiente: 'produccion' }).ok).toBe(false)
    expect(validarCreateChargeBody({ registro_id: UUID, ambiente: 'prod' }).ok).toBe(true)
    expect(validarCreateChargeBody({ registro_id: UUID, ambiente: 'sandbox' }).ok).toBe(true)
  })

  it('url no-http(s) → rechazada (javascript:, data:)', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x']) {
      const r = validarCreateChargeBody({ registro_id: UUID, url_retorno: url })
      expect(r.ok).toBe(false)
    }
  })

  it('descripcion con más de 500 chars → rechazada', () => {
    const r = validarCreateChargeBody({ registro_id: UUID, descripcion: 'x'.repeat(501) })
    expect(r.ok).toBe(false)
  })
})
