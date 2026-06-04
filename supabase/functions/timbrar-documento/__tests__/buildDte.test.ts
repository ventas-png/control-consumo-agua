// serv:S11 — Tests del helper PURO buildDte.ts (mapeo filas → DTE canónico).
// Corren con vitest (npx vitest run --dir supabase/functions).

import { describe, it, expect } from 'vitest'
import {
  armarDteDesdeFilas,
  emisorDesdeCompany,
  receptorDesdeCliente,
  facturaDesdeRegistro,
  regimenDeCompany,
  type CompanyRow,
  type ClienteRow,
  type RegistroRow,
} from '../buildDte.ts'

const companyGt: CompanyRow = {
  id: 'c1',
  nombre: 'Aguas Comercial',
  nombre_fiscal: 'Aguas Sociedad Anónima',
  nit: '12345679',
  tax_id: '99999999',
  regimen_fiscal: 'fel_gt',
  proveedor_timbrado: 'sandbox',
  address_line1: 'Calle 1',
  address_city: 'Guatemala',
  iva_tasa_default: 0.12,
}

const registro: RegistroRow = {
  id: 'reg-1',
  cliente_id: 'cli-1',
  cliente_nombre: 'Juan del registro',
  mes: 'junio 2026',
  monto_calculado: '100', // numeric llega como string desde PG
  iva_tasa: '0.12',
  iva_monto: '12',
  total_a_pagar: '112',
}

describe('buildDte — regimenDeCompany', () => {
  it('devuelve el régimen válido', () => {
    expect(regimenDeCompany(companyGt)).toBe('fel_gt')
    expect(regimenDeCompany({ ...companyGt, regimen_fiscal: 'cfdi_mx' })).toBe('cfdi_mx')
  })
  it('null para ninguno/desconocido', () => {
    expect(regimenDeCompany({ ...companyGt, regimen_fiscal: 'ninguno' })).toBeNull()
    expect(regimenDeCompany({ ...companyGt, regimen_fiscal: null })).toBeNull()
  })
})

describe('buildDte — emisorDesdeCompany', () => {
  it('usa nombre_fiscal y NIT (fallback tax_id) en GT', () => {
    const e = emisorDesdeCompany(companyGt, 'fel_gt')
    expect(e.nombreFiscal).toBe('Aguas Sociedad Anónima')
    expect(e.nit).toBe('12345679')
    expect(e.direccion?.ciudad).toBe('Guatemala')
  })
  it('cae a tax_id si no hay nit', () => {
    const e = emisorDesdeCompany({ ...companyGt, nit: null }, 'fel_gt')
    expect(e.nit).toBe('99999999')
  })
})

describe('buildDte — receptorDesdeCliente', () => {
  it('usa datos del cliente cuando existe', () => {
    const cli: ClienteRow = { id: 'cli-1', nombre: 'Juan Pérez', nit: '5519829' }
    const r = receptorDesdeCliente(cli, registro, 'fel_gt')
    expect(r.nombre).toBe('Juan Pérez')
    expect(r.nit).toBe('5519829')
  })
  it('GT: default CF cuando el cliente no tiene NIT', () => {
    const cli: ClienteRow = { id: 'cli-1', nombre: 'Sin NIT' }
    expect(receptorDesdeCliente(cli, registro, 'fel_gt').nit).toBe('CF')
  })
  it('cae al nombre del registro si no hay cliente', () => {
    const r = receptorDesdeCliente(null, registro, 'fel_gt')
    expect(r.nombre).toBe('Juan del registro')
    expect(r.nit).toBe('CF')
  })
  it('MX: no fuerza CF (deja null)', () => {
    const cli: ClienteRow = { id: 'c', nombre: 'X' }
    expect(receptorDesdeCliente(cli, registro, 'cfdi_mx').nit).toBeNull()
  })
})

describe('buildDte — facturaDesdeRegistro', () => {
  it('parsea numerics string → number', () => {
    const f = facturaDesdeRegistro(registro, 0.12)
    expect(f.subtotal).toBe(100)
    expect(f.ivaTasa).toBe(0.12)
    expect(f.ivaMonto).toBe(12)
    expect(f.total).toBe(112)
  })
  it('usa iva_tasa_default cuando el registro no trae iva_tasa', () => {
    const f = facturaDesdeRegistro({ ...registro, iva_tasa: null }, 0.16)
    expect(f.ivaTasa).toBe(0.16)
  })
  it('total cae a monto_con_iva si no hay total_a_pagar', () => {
    const f = facturaDesdeRegistro({ ...registro, total_a_pagar: null, monto_con_iva: '111.5' }, 0.12)
    expect(f.total).toBe(111.5)
  })
})

describe('buildDte — armarDteDesdeFilas', () => {
  it('arma un DTE GT completo', () => {
    const cli: ClienteRow = { id: 'cli-1', nombre: 'Juan Pérez', nit: '5519829' }
    const { dte, regimen } = armarDteDesdeFilas({
      company: companyGt,
      cliente: cli,
      registro,
      fechaEmision: '2026-06-04T00:00:00.000Z',
    })
    expect(regimen).toBe('fel_gt')
    expect(dte.emisor.nombre).toBe('Aguas Sociedad Anónima')
    expect(dte.emisor.nit).toBe('12345679')
    expect(dte.receptor.nombre).toBe('Juan Pérez')
    expect(dte.total).toBe(112)
    expect(dte.moneda).toBe('GTQ')
    expect(dte.registroId).toBe('reg-1')
  })

  it('lanza si el régimen es ninguno', () => {
    expect(() =>
      armarDteDesdeFilas({
        company: { ...companyGt, regimen_fiscal: 'ninguno' },
        cliente: null,
        registro,
      }),
    ).toThrow(/régimen fiscal/)
  })
})
