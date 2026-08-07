// Tests de la lógica pura de fiscal-test-connection (infra:I22 · Track T8/T5).
// Como el resto de tests de edge fns, corre bajo vitest (no Deno) tratando el
// módulo como TS normal. Cubre: normalización del ambiente, mapeo de rows
// (companies/projects) a config fiscal por nivel, precedencia de resolución del
// tenant, gate de autorización por tenant y el override de credenciales
// locación→empresa. La config efectiva y los providers YA están cubiertos por
// los tests de _shared/fiscal — aquí no se duplican.

import { describe, it, expect } from 'vitest'
import {
  type CompanyRow,
  type ProjectRow,
  autorizadoParaTenant,
  empresaConfigDeRow,
  locacionConfigDeRow,
  normalizarAmbiente,
  resolverCompanyId,
} from '../logic.ts'

describe('fiscal-test-connection/normalizarAmbiente', () => {
  it("solo 'prod' explícito produce prod; todo lo demás cae a sandbox", () => {
    expect(normalizarAmbiente('prod')).toBe('prod')
    expect(normalizarAmbiente('sandbox')).toBe('sandbox')
    expect(normalizarAmbiente('PROD')).toBe('sandbox') // case-sensitive a propósito
    expect(normalizarAmbiente('produccion')).toBe('sandbox')
    expect(normalizarAmbiente(undefined)).toBe('sandbox')
  })
})

describe('fiscal-test-connection/empresaConfigDeRow', () => {
  it('mapea snake_case → camelCase con todos los campos fiscales', () => {
    const row: CompanyRow = {
      id: 'c1',
      nombre: 'Mayan',
      nombre_fiscal: 'Mayan Residenciales S.A.',
      nit: '1234567-8',
      tax_id: 'TAX-1',
      rfc: 'MRS010101ABC',
      regimen_fiscal: 'fel_gt',
      proveedor_timbrado: 'infile',
      address_postal_code: '01010',
    }
    expect(empresaConfigDeRow(row)).toEqual({
      regimenFiscal: 'fel_gt',
      nombre: 'Mayan',
      nombreFiscal: 'Mayan Residenciales S.A.',
      nit: '1234567-8',
      taxId: 'TAX-1',
      rfc: 'MRS010101ABC',
      proveedorTimbrado: 'infile',
      codigoPostal: '01010',
    })
  })

  it('campos ausentes/undefined se normalizan a null (no undefined)', () => {
    const cfg = empresaConfigDeRow({ id: 'c1' })
    expect(cfg).toEqual({
      regimenFiscal: null,
      nombre: null,
      nombreFiscal: null,
      nit: null,
      taxId: null,
      rfc: null,
      proveedorTimbrado: null,
      codigoPostal: null,
    })
  })
})

describe('fiscal-test-connection/locacionConfigDeRow', () => {
  it('mapea el override de la locación incluyendo establecimiento/serie', () => {
    const row: ProjectRow = {
      id: 'p1',
      company_id: 'c1',
      nombre: 'Torre A',
      nombre_fiscal: null,
      nit: null,
      rfc: null,
      regimen_fiscal: 'cfdi_mx',
      proveedor_timbrado: 'facturama',
      establecimiento: '2',
      lugar_expedicion: '06600',
      serie_fiscal: 'B',
    }
    expect(locacionConfigDeRow(row)).toEqual({
      regimenFiscal: 'cfdi_mx',
      nombre: 'Torre A',
      nombreFiscal: null,
      nit: null,
      rfc: null,
      proveedorTimbrado: 'facturama',
      establecimiento: '2',
      lugarExpedicion: '06600',
      serieFiscal: 'B',
    })
  })

  it('campos ausentes se normalizan a null', () => {
    const cfg = locacionConfigDeRow({ id: 'p1' })
    expect(Object.values(cfg).every(v => v === null)).toBe(true)
  })
})

describe('fiscal-test-connection/resolverCompanyId (precedencia de tenant)', () => {
  it('el proyecto es autoritativo sobre body y JWT', () => {
    expect(resolverCompanyId('c-proj', 'c-body', 'c-jwt')).toBe('c-proj')
  })

  it('sin proyecto gana el body; sin body, el JWT; sin nada, null', () => {
    expect(resolverCompanyId(undefined, 'c-body', 'c-jwt')).toBe('c-body')
    expect(resolverCompanyId(null, undefined, 'c-jwt')).toBe('c-jwt')
    expect(resolverCompanyId(undefined, undefined, null)).toBe(null)
  })
})

describe('fiscal-test-connection/autorizadoParaTenant (gate del ping)', () => {
  it('interno (service_role) y super_admin pasan siempre', () => {
    expect(autorizadoParaTenant({ internal: true, callerIsSuperAdmin: false, callerCompanyId: null }, 'c1')).toBe(true)
    expect(autorizadoParaTenant({ internal: false, callerIsSuperAdmin: true, callerCompanyId: 'otra' }, 'c1')).toBe(true)
  })

  it('admin/owner NO puede probar la conexión de otro tenant', () => {
    expect(autorizadoParaTenant({ internal: false, callerIsSuperAdmin: false, callerCompanyId: 'c1' }, 'c1')).toBe(true)
    expect(autorizadoParaTenant({ internal: false, callerIsSuperAdmin: false, callerCompanyId: 'c1' }, 'c2')).toBe(false)
    expect(autorizadoParaTenant({ internal: false, callerIsSuperAdmin: false, callerCompanyId: null }, 'c2')).toBe(false)
  })
})

