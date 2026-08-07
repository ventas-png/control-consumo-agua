// Tests de la lógica pura de fiscal-save-credentials (infra:I22 · Track T8/T5).
// Como el resto de tests de edge fns, corre bajo vitest (no Deno) tratando el
// módulo como TS normal. Cubre: validación del payload de credenciales por
// ambiente (bóveda fiscal_pac_secrets), normalización del proveedor, precedencia
// de resolución del tenant, gate de autorización por tenant (no cross-tenant) y
// el MERGE que preserva el ambiente no enviado.

import { describe, it, expect } from 'vitest'
import {
  autorizadoParaTenant,
  esObjeto,
  mergeCredenciales,
  normalizarProveedor,
  resolverCompanyId,
  tieneCredenciales,
} from '../validate.ts'

describe('fiscal-save-credentials/esObjeto', () => {
  it('acepta objetos planos', () => {
    expect(esObjeto({})).toBe(true)
    expect(esObjeto({ usuario: 'x' })).toBe(true)
  })

  it('rechaza null, arrays y primitivos', () => {
    expect(esObjeto(null)).toBe(false)
    expect(esObjeto(undefined)).toBe(false)
    expect(esObjeto(['x'])).toBe(false)
    expect(esObjeto('credenciales')).toBe(false)
    expect(esObjeto(42)).toBe(false)
  })
})

describe('fiscal-save-credentials/tieneCredenciales', () => {
  it('requiere objeto plano con al menos una clave', () => {
    expect(tieneCredenciales({ usuario: 'x', clave: 'y' })).toBe(true)
    expect(tieneCredenciales({})).toBe(false) // objeto vacío NO cuenta
    expect(tieneCredenciales(null)).toBe(false)
    expect(tieneCredenciales([1])).toBe(false)
  })
})

describe('fiscal-save-credentials/normalizarProveedor', () => {
  it('trim y default "sandbox" para vacío/ausente', () => {
    expect(normalizarProveedor('  infile ')).toBe('infile')
    expect(normalizarProveedor('facturama')).toBe('facturama')
    expect(normalizarProveedor('')).toBe('sandbox')
    expect(normalizarProveedor('   ')).toBe('sandbox')
    expect(normalizarProveedor(undefined)).toBe('sandbox')
  })
})

describe('fiscal-save-credentials/resolverCompanyId (precedencia de tenant)', () => {
  it('el proyecto es autoritativo sobre body y JWT', () => {
    expect(resolverCompanyId('c-proj', 'c-body', 'c-jwt')).toBe('c-proj')
  })

  it('sin proyecto gana el body; sin body, el JWT; sin nada, null', () => {
    expect(resolverCompanyId(null, 'c-body', 'c-jwt')).toBe('c-body')
    expect(resolverCompanyId(null, undefined, 'c-jwt')).toBe('c-jwt')
    expect(resolverCompanyId(null, undefined, null)).toBe(null)
  })
})

describe('fiscal-save-credentials/autorizadoParaTenant (gate de la bóveda)', () => {
  it('interno (service_role) y super_admin pasan siempre', () => {
    expect(autorizadoParaTenant({ internal: true, callerIsSuperAdmin: false, callerCompanyId: null }, 'c1')).toBe(true)
    expect(autorizadoParaTenant({ internal: false, callerIsSuperAdmin: true, callerCompanyId: 'otra' }, 'c1')).toBe(true)
  })

  it('admin/owner NO puede escribir credenciales de otro tenant', () => {
    expect(autorizadoParaTenant({ internal: false, callerIsSuperAdmin: false, callerCompanyId: 'c1' }, 'c1')).toBe(true)
    expect(autorizadoParaTenant({ internal: false, callerIsSuperAdmin: false, callerCompanyId: 'c1' }, 'c2')).toBe(false)
    // Llamante sin empresa (callerCompanyId null) tampoco pasa.
    expect(autorizadoParaTenant({ internal: false, callerIsSuperAdmin: false, callerCompanyId: null }, 'c2')).toBe(false)
  })
})

describe('fiscal-save-credentials/mergeCredenciales (MERGE por ambiente)', () => {
  const guardadas = { sandbox: { usuario: 'sb-old' }, prod: { usuario: 'pr-old' } }

  it('solo pisa el ambiente que viene con credenciales; el otro se preserva', () => {
    expect(mergeCredenciales(guardadas, { usuario: 'sb-new' }, undefined)).toEqual({
      sandbox: { usuario: 'sb-new' },
      prod: { usuario: 'pr-old' },
    })
    expect(mergeCredenciales(guardadas, undefined, { usuario: 'pr-new' })).toEqual({
      sandbox: { usuario: 'sb-old' },
      prod: { usuario: 'pr-new' },
    })
  })

  it('mandar {} o null NO borra el ambiente guardado', () => {
    expect(mergeCredenciales(guardadas, {}, null)).toEqual(guardadas)
  })

  it('sin fila previa parte de {} y agrega solo lo enviado', () => {
    expect(mergeCredenciales({}, { token: 't' }, undefined)).toEqual({ sandbox: { token: 't' } })
  })

  it('no muta el objeto de credenciales actuales', () => {
    const actuales = { sandbox: { usuario: 'sb-old' } }
    mergeCredenciales(actuales, { usuario: 'nuevo' }, { usuario: 'p' })
    expect(actuales).toEqual({ sandbox: { usuario: 'sb-old' } })
  })
})
