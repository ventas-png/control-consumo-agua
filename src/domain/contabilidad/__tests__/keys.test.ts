import { describe, it, expect } from 'vitest'
import { contabilidadKeys } from '../keys'

describe('contabilidadKeys', () => {
  it('expone una raíz estable para invalidación masiva del dominio', () => {
    expect(contabilidadKeys.all).toEqual(['contabilidad'])
  })

  it('cuentas scopea por companyId', () => {
    expect(contabilidadKeys.cuentas('c1')).toEqual(['contabilidad', 'cuentas', 'c1', null])
    expect(contabilidadKeys.cuentas('c1', 'p1')).toEqual(['contabilidad', 'cuentas', 'c1', 'p1'])
  })

  it('asientos incluye company/proyecto/periodo/estado en el scope', () => {
    expect(contabilidadKeys.asientos('c1', 'p1', '2026-06', 'publicado')).toEqual([
      'contabilidad', 'asientos', 'c1', 'p1', '2026-06', 'publicado',
    ])
  })

  it('normaliza scope ausente a null para que la key sea estable', () => {
    expect(contabilidadKeys.cuentas()).toEqual(['contabilidad', 'cuentas', null, null])
    expect(contabilidadKeys.asientos()).toEqual([
      'contabilidad', 'asientos', null, null, null, null,
    ])
    expect(contabilidadKeys.balanza()).toEqual([
      'contabilidad', 'balanza', null, null, null,
    ])
  })

  it('todas las entidades comparten el prefijo de la raíz', () => {
    expect(contabilidadKeys.balanza('c1', null, '2026-06').slice(0, 1)).toEqual([
      ...contabilidadKeys.all,
    ])
    expect(contabilidadKeys.mayor('q1', '2026-01-01', '2026-06-30').slice(0, 1)).toEqual([
      ...contabilidadKeys.all,
    ])
  })

  it('cambiar un parámetro del scope produce una key distinta (cache aislado)', () => {
    expect(contabilidadKeys.balanza('c1', 'p1', '2026-06')).not.toEqual(
      contabilidadKeys.balanza('c1', 'p1', '2026-07'),
    )
  })
})
