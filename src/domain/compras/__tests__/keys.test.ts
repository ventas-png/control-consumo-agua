import { describe, expect, it } from 'vitest'
import { comprasKeys } from '../keys'

describe('comprasKeys', () => {
  it('cuelga todo de una raíz común para poder invalidar el dominio entero', () => {
    const raiz = comprasKeys.all[0]
    expect(comprasKeys.ordenes('c1', null)[0]).toBe(raiz)
    expect(comprasKeys.recepciones('c1', null)[0]).toBe(raiz)
    expect(comprasKeys.contrasenas('c1', null)[0]).toBe(raiz)
    expect(comprasKeys.activos('c1', null)[0]).toBe(raiz)
  })

  it('normaliza el scope ausente a null para que la key sea estable', () => {
    expect(comprasKeys.ordenes()).toEqual(['compras', 'ordenes', null, null, null])
    expect(comprasKeys.ordenes(undefined, undefined, undefined)).toEqual(comprasKeys.ordenes())
  })

  // La empresa (project_id null) y un proyecto son contabilidades DISTINTAS.
  // Si compartieran key, cambiar de contabilidad mostraría los documentos de la
  // anterior hasta que la caché expirara.
  it('separa la contabilidad de la empresa de la de cada proyecto', () => {
    expect(comprasKeys.ordenes('c1', null)).not.toEqual(comprasKeys.ordenes('c1', 'p1'))
    expect(comprasKeys.recepciones('c1', null)).not.toEqual(comprasKeys.recepciones('c1', 'p1'))
    expect(comprasKeys.contrasenas('c1', 'p1')).not.toEqual(comprasKeys.contrasenas('c1', 'p2'))
  })

  it('separa por estado para que los filtros no se pisen entre sí', () => {
    expect(comprasKeys.ordenes('c1', 'p1', 'borrador')).not.toEqual(
      comprasKeys.ordenes('c1', 'p1', 'aprobada'),
    )
  })

  it('las keys por documento dependen solo de su id', () => {
    expect(comprasKeys.ordenLineas('oc1')).toEqual(['compras', 'orden-lineas', 'oc1'])
    expect(comprasKeys.cuadre('f1')).toEqual(['compras', 'cuadre', 'f1'])
    expect(comprasKeys.contrasenaFacturas()).toEqual(['compras', 'contrasena-facturas', null])
  })
})
