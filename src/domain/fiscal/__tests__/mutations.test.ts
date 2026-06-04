import { describe, it, expect, vi } from 'vitest'

// Stub del cliente Supabase: mutations.ts lo importa para invocar el edge / leer
// el régimen, pero esta suite solo ejercita el GATE PURO (sin red). Evita el
// throw de env vars al cargar el módulo. Mismo patrón que facturacion/mutations.test.ts.
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => { throw new Error('default client should not be used in pure-logic tests') },
    functions: { invoke: () => { throw new Error('invoke should not be used in pure-logic tests') } },
  },
}))

import {
  puedeDispararTimbrado,
  TimbradoNoPermitidoError,
  buildConfigFiscalPatch,
} from '../mutations'

// Cubre el GATE del botón "Timbrar". La autoridad real de la transición es el
// edge (server) + businessFiscal.ts (puro, ya testeado en su propia suite); aquí
// verificamos que la UI razona correctamente sobre el ÚLTIMO documento del
// registro para no re-timbrar ni duplicar.
describe('puedeDispararTimbrado', () => {
  it('permite timbrar cuando aún no hay documento (primer intento)', () => {
    expect(puedeDispararTimbrado(null)).toBe(true)
    expect(puedeDispararTimbrado(undefined)).toBe(true)
  })

  it('permite reintentar cuando el último documento fue rechazado', () => {
    expect(puedeDispararTimbrado('rechazado')).toBe(true)
  })

  it('NO permite timbrar si ya hay uno encolado/en vuelo (por_timbrar)', () => {
    expect(puedeDispararTimbrado('por_timbrar')).toBe(false)
  })

  it('NO permite re-timbrar un comprobante ya timbrado', () => {
    expect(puedeDispararTimbrado('timbrado')).toBe(false)
  })

  it('NO permite timbrar un comprobante cancelado (terminal)', () => {
    expect(puedeDispararTimbrado('cancelado')).toBe(false)
  })

  it('un estado desconocido se normaliza a borrador → no timbrable (requiere emitir/encolar primero)', () => {
    // normalizarEstadoFiscal cae a 'borrador'; borrador no admite 'reintentar'.
    expect(puedeDispararTimbrado('basura-no-valida')).toBe(false)
  })
})

describe('TimbradoNoPermitidoError', () => {
  it('lleva el estado actual y un nombre estable', () => {
    const err = new TimbradoNoPermitidoError('timbrado')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('TimbradoNoPermitidoError')
    expect(err.estadoActual).toBe('timbrado')
    expect(err.message).toContain('timbrado')
  })
})

// serv:S11 (UI parte 2) — patch de columnas NO secretas del emisor. Verifica el
// mapeo camelCase→snake_case, la diferencia empresa/locación (columnas que solo
// existen en projects) y la semántica de omitir (undefined) vs limpiar ('' → null).
describe('buildConfigFiscalPatch', () => {
  it('mapea los campos comunes a snake_case (ámbito empresa)', () => {
    const patch = buildConfigFiscalPatch(
      { tipo: 'empresa' },
      { regimenFiscal: 'fel_gt', nombreFiscal: 'ACME SA', nit: '1234567-8', proveedorTimbrado: 'infile' },
    )
    expect(patch).toEqual({
      regimen_fiscal: 'fel_gt',
      nombre_fiscal: 'ACME SA',
      nit: '1234567-8',
      proveedor_timbrado: 'infile',
    })
  })

  it('NO incluye columnas solo-locación (establecimiento/serie/lugar) en ámbito empresa', () => {
    const patch = buildConfigFiscalPatch(
      { tipo: 'empresa' },
      { establecimiento: '1', serieFiscal: 'A', lugarExpedicion: '01000' },
    )
    expect('establecimiento' in patch).toBe(false)
    expect('serie_fiscal' in patch).toBe(false)
    expect('lugar_expedicion' in patch).toBe(false)
    expect(patch).toEqual({})
  })

  it('SÍ incluye columnas solo-locación en ámbito locación', () => {
    const patch = buildConfigFiscalPatch(
      { tipo: 'locacion', projectId: 'p1' },
      { establecimiento: '2', serieFiscal: 'B', lugarExpedicion: '64000', rfc: 'AAA010101AAA' },
    )
    expect(patch).toEqual({
      establecimiento: '2',
      serie_fiscal: 'B',
      lugar_expedicion: '64000',
      rfc: 'AAA010101AAA',
    })
  })

  it('omite los campos undefined (no se tocan esas columnas)', () => {
    const patch = buildConfigFiscalPatch({ tipo: 'empresa' }, { nit: '5' })
    expect(Object.keys(patch)).toEqual(['nit'])
  })

  it("convierte '' (y whitespace) a null = limpiar la columna / heredar", () => {
    const patch = buildConfigFiscalPatch(
      { tipo: 'locacion', projectId: 'p1' },
      { nit: '   ', nombreFiscal: '', establecimiento: 'x' },
    )
    expect(patch.nit).toBeNull()
    expect(patch.nombre_fiscal).toBeNull()
    expect(patch.establecimiento).toBe('x')
  })

  it('recorta el whitespace de los valores presentes', () => {
    const patch = buildConfigFiscalPatch({ tipo: 'empresa' }, { nombreFiscal: '  ACME  ' })
    expect(patch.nombre_fiscal).toBe('ACME')
  })
})
