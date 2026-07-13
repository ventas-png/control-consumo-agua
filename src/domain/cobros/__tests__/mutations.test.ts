// Cobros pluggable — Tests del patch builder PURO de la config de pago.
import { describe, it, expect, vi } from 'vitest'

// Stub del cliente Supabase: mutations.ts lo importa para invocar los edges, pero
// esta suite solo ejercita el patch builder PURO (sin red). Evita el throw de env
// vars al cargar el módulo. Mismo patrón que fiscal/mutations.test.ts.
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => { throw new Error('default client should not be used in pure-logic tests') },
    functions: { invoke: () => { throw new Error('invoke should not be used in pure-logic tests') } },
  },
}))

import { buildConfigPagoPatch } from '../mutations'

describe('buildConfigPagoPatch', () => {
  it('empresa: guarda el proveedor elegido', () => {
    expect(buildConfigPagoPatch({ tipo: 'empresa' }, 'qpaypro')).toEqual({ proveedor_pago: 'qpaypro' })
  })

  it('empresa: vacío/null cae a sandbox (la columna es NOT NULL)', () => {
    expect(buildConfigPagoPatch({ tipo: 'empresa' }, '')).toEqual({ proveedor_pago: 'sandbox' })
    expect(buildConfigPagoPatch({ tipo: 'empresa' }, null)).toEqual({ proveedor_pago: 'sandbox' })
  })

  it('empresa: undefined = no tocar (patch vacío)', () => {
    expect(buildConfigPagoPatch({ tipo: 'empresa' }, undefined)).toEqual({})
  })

  it('locación: guarda el override', () => {
    expect(buildConfigPagoPatch({ tipo: 'locacion', projectId: 'p1' }, 'visanet')).toEqual({ proveedor_pago: 'visanet' })
  })

  it('locación: vacío/null = limpiar a null (hereda de la empresa)', () => {
    expect(buildConfigPagoPatch({ tipo: 'locacion', projectId: 'p1' }, '')).toEqual({ proveedor_pago: null })
    expect(buildConfigPagoPatch({ tipo: 'locacion', projectId: 'p1' }, null)).toEqual({ proveedor_pago: null })
  })

  it('locación: undefined = no tocar (patch vacío)', () => {
    expect(buildConfigPagoPatch({ tipo: 'locacion', projectId: 'p1' }, undefined)).toEqual({})
  })

  it('empresa: monedaDefault se guarda en minúsculas (default_currency)', () => {
    expect(buildConfigPagoPatch({ tipo: 'empresa' }, 'qpaypro', 'GTQ')).toEqual({
      proveedor_pago: 'qpaypro',
      default_currency: 'gtq',
    })
  })

  it('empresa: monedaDefault sin proveedor también genera patch', () => {
    expect(buildConfigPagoPatch({ tipo: 'empresa' }, undefined, 'usd')).toEqual({ default_currency: 'usd' })
  })

  it('empresa: monedaDefault vacía/undefined = no tocar la moneda', () => {
    expect(buildConfigPagoPatch({ tipo: 'empresa' }, 'qpaypro', '')).toEqual({ proveedor_pago: 'qpaypro' })
    expect(buildConfigPagoPatch({ tipo: 'empresa' }, 'qpaypro', undefined)).toEqual({ proveedor_pago: 'qpaypro' })
  })

  it('locación: monedaDefault se ignora (la moneda es de la empresa)', () => {
    expect(buildConfigPagoPatch({ tipo: 'locacion', projectId: 'p1' }, 'visanet', 'GTQ')).toEqual({
      proveedor_pago: 'visanet',
    })
  })

  it('empresa: ambientePago se guarda; solo "prod" exacto activa producción', () => {
    expect(buildConfigPagoPatch({ tipo: 'empresa' }, undefined, undefined, 'prod')).toEqual({ ambiente_pago: 'prod' })
    expect(buildConfigPagoPatch({ tipo: 'empresa' }, undefined, undefined, 'sandbox')).toEqual({ ambiente_pago: 'sandbox' })
    // Valor raro o vacío cae a sandbox (default seguro; la columna es NOT NULL).
    expect(buildConfigPagoPatch({ tipo: 'empresa' }, undefined, undefined, 'produccion')).toEqual({ ambiente_pago: 'sandbox' })
    expect(buildConfigPagoPatch({ tipo: 'empresa' }, undefined, undefined, '')).toEqual({ ambiente_pago: 'sandbox' })
  })

  it('locación: ambientePago vacío/null = hereda (null); con valor, override', () => {
    expect(buildConfigPagoPatch({ tipo: 'locacion', projectId: 'p1' }, undefined, undefined, '')).toEqual({ ambiente_pago: null })
    expect(buildConfigPagoPatch({ tipo: 'locacion', projectId: 'p1' }, undefined, undefined, null)).toEqual({ ambiente_pago: null })
    expect(buildConfigPagoPatch({ tipo: 'locacion', projectId: 'p1' }, undefined, undefined, 'prod')).toEqual({ ambiente_pago: 'prod' })
    expect(buildConfigPagoPatch({ tipo: 'locacion', projectId: 'p1' }, undefined, undefined, 'sandbox')).toEqual({ ambiente_pago: 'sandbox' })
  })

  it('ambientePago undefined = no tocar el ambiente', () => {
    expect(buildConfigPagoPatch({ tipo: 'empresa' }, 'qpaypro')).toEqual({ proveedor_pago: 'qpaypro' })
    expect(buildConfigPagoPatch({ tipo: 'locacion', projectId: 'p1' }, undefined, undefined, undefined)).toEqual({})
  })
})
