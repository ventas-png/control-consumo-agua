// Tests de la lógica pura de payfac-test-connection (infra:I22 · Track T8/T5).
// Como el resto de tests de edge fns, corre bajo vitest (no Deno) tratando el
// módulo como TS normal. El ping al provider y el resolver de config efectiva ya
// están cubiertos en _shared/payments/__tests__ — aquí solo la lógica propia del
// handler: default seguro de ambiente, lectura de credenciales por ambiente
// (NUNCA la bóveda completa), tenant efectivo y gate multi-tenant.

import { describe, it, expect } from 'vitest'
import {
  autorizadoParaTenant,
  credsDeAmbiente,
  parseAmbiente,
  resolverCompanyId,
} from '../logic.ts'

describe('payfac-test-connection/parseAmbiente', () => {
  it("solo 'prod' literal prueba prod; cualquier otra cosa cae a sandbox", () => {
    expect(parseAmbiente('prod')).toBe('prod')
    expect(parseAmbiente('sandbox')).toBe('sandbox')
    expect(parseAmbiente('PROD')).toBe('sandbox') // case-sensitive a propósito
    expect(parseAmbiente(undefined)).toBe('sandbox')
  })
})

describe('payfac-test-connection/credsDeAmbiente', () => {
  const boveda = { sandbox: { x_login: 'sb' }, prod: { x_login: 'pr', x_api_key: 'k' } }

  it('devuelve SOLO el ambiente pedido, nunca la bóveda completa', () => {
    const creds = credsDeAmbiente(boveda, 'prod')
    expect(creds).toEqual({ x_login: 'pr', x_api_key: 'k' })
    expect(creds && 'sandbox' in creds).toBe(false)
  })

  it('null ante fila ausente, jsonb corrupto o ambiente no-objeto', () => {
    expect(credsDeAmbiente(undefined, 'sandbox')).toBeNull()
    expect(credsDeAmbiente('texto', 'sandbox')).toBeNull()
    expect(credsDeAmbiente({ prod: boveda.prod }, 'sandbox')).toBeNull()
    expect(credsDeAmbiente({ sandbox: ['x'] }, 'sandbox')).toBeNull()
  })
})

describe('payfac-test-connection/resolverCompanyId', () => {
  it('precedencia proyecto → body → llamante → null', () => {
    expect(resolverCompanyId('co-proj', 'co-body', 'co-caller')).toBe('co-proj')
    expect(resolverCompanyId(null, 'co-body', 'co-caller')).toBe('co-body')
    expect(resolverCompanyId(null, undefined, 'co-caller')).toBe('co-caller')
    expect(resolverCompanyId(null, undefined, null)).toBeNull()
  })
})

describe('payfac-test-connection/autorizadoParaTenant', () => {
  it('interno y super_admin prueban cualquier tenant; admin/owner solo el suyo', () => {
    expect(autorizadoParaTenant(true, false, null, 'co-x')).toBe(true)
    expect(autorizadoParaTenant(false, true, 'co-1', 'co-x')).toBe(true)
    expect(autorizadoParaTenant(false, false, 'co-1', 'co-1')).toBe(true)
    expect(autorizadoParaTenant(false, false, 'co-1', 'co-2')).toBe(false)
    expect(autorizadoParaTenant(false, false, null, 'co-1')).toBe(false)
  })
})
