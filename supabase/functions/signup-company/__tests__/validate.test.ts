// Tests de la validación de signup-company (infra:I22). Pura → vitest directo.

import { describe, it, expect } from 'vitest'
import { validatePayload, type SignupPayload } from '../validate.ts'

const ok: SignupPayload = {
  email: 'a@b.com',
  password: 'abc12345',
  full_name: 'Juan Pérez',
  company_name: 'Acme',
  servicio_agua: true,
}

describe('signup-company/validatePayload', () => {
  it('acepta un payload válido', () => {
    expect(validatePayload(ok)).toBeNull()
  })

  it('rechaza email faltante o con formato inválido', () => {
    expect(validatePayload({ ...ok, email: undefined })).toMatch(/Email/)
    expect(validatePayload({ ...ok, email: 'no-arroba' })).toMatch(/Formato de email/)
  })

  it('rechaza password corta o sin letra+número', () => {
    expect(validatePayload({ ...ok, password: 'a1b2' })).toMatch(/al menos 8/)
    expect(validatePayload({ ...ok, password: 'sololetras' })).toMatch(/letra y un numero/)
    expect(validatePayload({ ...ok, password: '12345678' })).toMatch(/letra y un numero/)
  })

  it('rechaza nombre o empresa faltantes', () => {
    expect(validatePayload({ ...ok, full_name: 'x' })).toMatch(/Nombre completo/)
    expect(validatePayload({ ...ok, company_name: '' })).toMatch(/Nombre de la empresa/)
  })

  it('exige al menos un servicio (agua o condominios)', () => {
    expect(validatePayload({ ...ok, servicio_agua: false, servicio_condominios: false })).toMatch(/al menos un servicio/)
    expect(validatePayload({ ...ok, servicio_agua: false, servicio_condominios: true })).toBeNull()
  })
})
