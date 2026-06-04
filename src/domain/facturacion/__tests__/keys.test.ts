import { describe, it, expect } from 'vitest'
import { facturacionKeys } from '../keys'

describe('facturacionKeys', () => {
  it('expone una raíz estable para invalidación masiva del dominio', () => {
    expect(facturacionKeys.all).toEqual(['facturacion'])
  })

  it('facturas scopea por companyId', () => {
    expect(facturacionKeys.facturas('c1')).toEqual(['facturacion', 'facturas', 'c1'])
  })

  it('facturasPorProyecto incluye company y proyecto en el scope', () => {
    expect(facturacionKeys.facturasPorProyecto('c1', 'p1')).toEqual([
      'facturacion', 'facturas', 'por-proyecto', 'c1', 'p1',
    ])
  })

  it('reglasMora scopea por companyId', () => {
    expect(facturacionKeys.reglasMora('c1')).toEqual(['facturacion', 'reglas-mora', 'c1'])
  })

  it('ivaTasaDefault scopea por companyId', () => {
    expect(facturacionKeys.ivaTasaDefault('c1')).toEqual(['facturacion', 'iva-tasa-default', 'c1'])
  })

  it('normaliza un scope ausente a null para que la key sea estable', () => {
    expect(facturacionKeys.facturas()).toEqual(['facturacion', 'facturas', null])
    expect(facturacionKeys.reglasMora()).toEqual(['facturacion', 'reglas-mora', null])
    expect(facturacionKeys.ivaTasaDefault()).toEqual(['facturacion', 'iva-tasa-default', null])
  })

  it('todas las entidades comparten el prefijo de la raíz', () => {
    expect(facturacionKeys.facturas('c1').slice(0, 1)).toEqual([...facturacionKeys.all])
    expect(facturacionKeys.reglasMora('c1').slice(0, 1)).toEqual([...facturacionKeys.all])
    expect(facturacionKeys.ivaTasaDefault('c1').slice(0, 1)).toEqual([...facturacionKeys.all])
  })

  it('cambiar el proyecto produce una key distinta (cache aislado)', () => {
    expect(facturacionKeys.facturasPorProyecto('c1', 'p1')).not.toEqual(
      facturacionKeys.facturasPorProyecto('c1', 'p2'),
    )
  })
})
