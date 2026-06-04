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
})
