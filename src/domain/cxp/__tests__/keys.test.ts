import { describe, it, expect } from 'vitest'
import { cxpKeys } from '../keys'

describe('cxpKeys', () => {
  it('expone una raíz estable para invalidación masiva del dominio', () => {
    expect(cxpKeys.all).toEqual(['cxp'])
  })

  it('facturas incluye company/proyecto/estado en el scope', () => {
    expect(cxpKeys.facturas('c1', 'p1', 'aprobada')).toEqual([
      'cxp', 'facturas', 'c1', 'p1', 'aprobada',
    ])
  })

  it('normaliza scope ausente a null para que la key sea estable', () => {
    expect(cxpKeys.proveedores()).toEqual(['cxp', 'proveedores', null])
    expect(cxpKeys.facturas()).toEqual(['cxp', 'facturas', null, null, null])
    expect(cxpKeys.aging()).toEqual(['cxp', 'aging', null, null])
  })

  it('todas las entidades comparten el prefijo de la raíz', () => {
    expect(cxpKeys.ordenes('c1').slice(0, 1)).toEqual([...cxpKeys.all])
    expect(cxpKeys.aging('c1', 'p1').slice(0, 1)).toEqual([...cxpKeys.all])
  })
})
