import { describe, it, expect } from 'vitest'
import { presupuestoKeys } from '../keys'

describe('presupuestoKeys', () => {
  it('expone una raíz estable para invalidación masiva del dominio', () => {
    expect(presupuestoKeys.all).toEqual(['presupuesto-erp'])
  })

  it('lista scopea por company y año', () => {
    expect(presupuestoKeys.lista('c1', 2026)).toEqual(['presupuesto-erp', 'lista', 'c1', 2026])
  })

  it('normaliza scope ausente a null', () => {
    expect(presupuestoKeys.lista()).toEqual(['presupuesto-erp', 'lista', null, null])
    expect(presupuestoKeys.partidas()).toEqual(['presupuesto-erp', 'partidas', null])
    expect(presupuestoKeys.vsReal()).toEqual(['presupuesto-erp', 'vs-real', null])
  })

  it('todas las entidades comparten el prefijo de la raíz', () => {
    expect(presupuestoKeys.vsReal('p1').slice(0, 1)).toEqual([...presupuestoKeys.all])
  })
})
