import { describe, it, expect } from 'vitest'
import { energiaKeys } from '../keys'

describe('energiaKeys', () => {
  it('expone una raíz estable para invalidación masiva del dominio', () => {
    expect(energiaKeys.all).toEqual(['energia'])
  })

  it('proveedores scopea por companyId', () => {
    expect(energiaKeys.proveedores('c1')).toEqual(['energia', 'proveedores', 'c1'])
  })

  it('tarifas scopea por companyId', () => {
    expect(energiaKeys.tarifas('c1')).toEqual(['energia', 'tarifas', 'c1'])
  })

  it('fuentes scopea por companyId', () => {
    expect(energiaKeys.fuentes('c1')).toEqual(['energia', 'fuentes', 'c1'])
  })

  it('facturas scopea por companyId', () => {
    expect(energiaKeys.facturas('c1')).toEqual(['energia', 'facturas', 'c1'])
  })

  it('normaliza companyId ausente a null para que la key sea estable', () => {
    expect(energiaKeys.proveedores()).toEqual(['energia', 'proveedores', null])
    expect(energiaKeys.tarifas()).toEqual(['energia', 'tarifas', null])
    expect(energiaKeys.fuentes()).toEqual(['energia', 'fuentes', null])
    expect(energiaKeys.facturas()).toEqual(['energia', 'facturas', null])
  })

  it('todas las entidades comparten el prefijo de la raíz', () => {
    expect(energiaKeys.proveedores('c1').slice(0, 1)).toEqual([...energiaKeys.all])
    expect(energiaKeys.tarifas('c1').slice(0, 1)).toEqual([...energiaKeys.all])
    expect(energiaKeys.fuentes('c1').slice(0, 1)).toEqual([...energiaKeys.all])
    expect(energiaKeys.facturas('c1').slice(0, 1)).toEqual([...energiaKeys.all])
  })

  it('cambiar el companyId produce una key distinta (cache aislado por tenant)', () => {
    expect(energiaKeys.proveedores('c1')).not.toEqual(energiaKeys.proveedores('c2'))
    expect(energiaKeys.facturas('c1')).not.toEqual(energiaKeys.facturas('c2'))
  })

  it('entidades distintas del mismo tenant producen keys distintas', () => {
    expect(energiaKeys.proveedores('c1')).not.toEqual(energiaKeys.tarifas('c1'))
    expect(energiaKeys.fuentes('c1')).not.toEqual(energiaKeys.facturas('c1'))
  })
})
