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

import { puedeDispararTimbrado, TimbradoNoPermitidoError } from '../mutations'

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
