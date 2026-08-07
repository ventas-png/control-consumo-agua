// Tests de la lógica pura de payfac-save-credentials (infra:I22 · Track T8/T5).
// Como el resto de tests de edge fns, corre bajo vitest (no Deno) tratando el
// módulo como TS normal. Cubre los invariantes de la bóveda payfac_secrets:
// MERGE por ambiente (guardar sandbox NUNCA pisa prod y viceversa), validación
// de credenciales no vacías, normalización del proveedor, resolución del tenant
// (project autoritativo) y el gate multi-tenant (admin/owner solo su empresa).

import { describe, it, expect } from 'vitest'
import {
  autorizadoParaTenant,
  esObjeto,
  mergeCredenciales,
  normalizarProveedor,
  resolverCompanyId,
  tieneCredenciales,
} from '../validate.ts'

describe('payfac-save-credentials/esObjeto', () => {
  it('acepta objetos planos (incluido el vacío)', () => {
    expect(esObjeto({})).toBe(true)
    expect(esObjeto({ x_login: 'a' })).toBe(true)
  })

  it('rechaza null, arrays y primitivos (jsonb corrupto o entrada maliciosa)', () => {
    expect(esObjeto(null)).toBe(false)
    expect(esObjeto(undefined)).toBe(false)
    expect(esObjeto(['x'])).toBe(false)
    expect(esObjeto('secreto')).toBe(false)
    expect(esObjeto(42)).toBe(false)
  })
})

describe('payfac-save-credentials/tieneCredenciales', () => {
  it('exige un objeto NO vacío', () => {
    expect(tieneCredenciales({ x_login: 'a' })).toBe(true)
    expect(tieneCredenciales({})).toBe(false) // {} no cuenta como credenciales
    expect(tieneCredenciales(null)).toBe(false)
    expect(tieneCredenciales(['x'])).toBe(false)
  })
})

describe('payfac-save-credentials/normalizarProveedor', () => {
  it('trim + minúsculas', () => {
    expect(normalizarProveedor('  QPayPro  ')).toBe('qpaypro')
    expect(normalizarProveedor('VISANET')).toBe('visanet')
  })

  it('vacío, espacios u omitido → sandbox (default de pruebas)', () => {
    expect(normalizarProveedor(undefined)).toBe('sandbox')
    expect(normalizarProveedor(null)).toBe('sandbox')
    expect(normalizarProveedor('')).toBe('sandbox')
    expect(normalizarProveedor('   ')).toBe('sandbox')
  })
})

describe('payfac-save-credentials/resolverCompanyId', () => {
  it('la empresa del PROYECTO es autoritativa sobre body y llamante', () => {
    expect(resolverCompanyId('co-proj', 'co-body', 'co-caller')).toBe('co-proj')
  })

  it('sin proyecto: gana el body; sin body: la del llamante; nada → null', () => {
    expect(resolverCompanyId(null, 'co-body', 'co-caller')).toBe('co-body')
    expect(resolverCompanyId(null, undefined, 'co-caller')).toBe('co-caller')
    expect(resolverCompanyId(null, undefined, null)).toBeNull()
  })
})

describe('payfac-save-credentials/autorizadoParaTenant', () => {
  it('service_role (interno) y super_admin operan sobre cualquier tenant', () => {
    expect(autorizadoParaTenant(true, false, null, 'co-ajena')).toBe(true)
    expect(autorizadoParaTenant(false, true, 'co-propia', 'co-ajena')).toBe(true)
  })

  it('admin/owner SOLO sobre su propia empresa (gate cross-tenant)', () => {
    expect(autorizadoParaTenant(false, false, 'co-1', 'co-1')).toBe(true)
    expect(autorizadoParaTenant(false, false, 'co-1', 'co-2')).toBe(false)
  })

  it('llamante sin empresa resuelta → denegado (salvo interno/super)', () => {
    expect(autorizadoParaTenant(false, false, null, 'co-1')).toBe(false)
  })
})

describe('payfac-save-credentials/mergeCredenciales', () => {
  const guardadas = {
    sandbox: { x_login: 'sb-old', x_api_key: 'sb-key' },
    prod: { x_login: 'pr-old', x_api_key: 'pr-key' },
  }

  it('guardar SOLO sandbox preserva prod intacto (no pisar credenciales de prod)', () => {
    const res = mergeCredenciales(guardadas, { x_login: 'sb-new' }, undefined)
    expect(res.sandbox).toEqual({ x_login: 'sb-new' })
    expect(res.prod).toEqual({ x_login: 'pr-old', x_api_key: 'pr-key' })
  })

  it('guardar SOLO prod preserva sandbox intacto', () => {
    const res = mergeCredenciales(guardadas, null, { x_login: 'pr-new' })
    expect(res.prod).toEqual({ x_login: 'pr-new' })
    expect(res.sandbox).toEqual({ x_login: 'sb-old', x_api_key: 'sb-key' })
  })

  it('un ambiente con {} vacío NO borra lo guardado (idempotencia del merge)', () => {
    const res = mergeCredenciales(guardadas, {}, {})
    expect(res).toEqual(guardadas)
  })

  it('ambos ambientes a la vez reemplazan ambos', () => {
    const res = mergeCredenciales(guardadas, { a: 1 }, { b: 2 })
    expect(res).toEqual({ sandbox: { a: 1 }, prod: { b: 2 } })
  })

  it('sin nada guardado, arranca desde el objeto vacío', () => {
    expect(mergeCredenciales({}, { a: 1 }, undefined)).toEqual({ sandbox: { a: 1 } })
  })

  it('NO muta la bóveda original (devuelve un objeto nuevo)', () => {
    const antes = JSON.parse(JSON.stringify(guardadas))
    mergeCredenciales(guardadas, { x: 1 }, { y: 2 })
    expect(guardadas).toEqual(antes)
  })
})
