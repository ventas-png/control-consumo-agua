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

  // `invalidateQueries` hace match POR PREFIJO. La key completa termina en el
  // projectId, así que invalidar con ella sólo alcanza a ESE ledger: guardar el
  // mapeo de un proyecto dejaba la pantalla de la empresa con datos viejos.
  // Los prefijos "de empresa" son los que alcanzan a todos sus ledgers.
  it('el prefijo de empresa alcanza al ledger de empresa y al de cada proyecto', () => {
    const prefijo = contabilidadKeys.mapeoDeEmpresa('c1')
    expect(contabilidadKeys.mapeo('c1', null).slice(0, prefijo.length)).toEqual([...prefijo])
    expect(contabilidadKeys.mapeo('c1', 'p1').slice(0, prefijo.length)).toEqual([...prefijo])

    const esp = contabilidadKeys.cuentasEspecialesDeEmpresa('c1')
    expect(contabilidadKeys.cuentasEspeciales('c1', null).slice(0, esp.length)).toEqual([...esp])
    expect(contabilidadKeys.cuentasEspeciales('c1', 'p1').slice(0, esp.length)).toEqual([...esp])
  })

  it('el prefijo de una empresa NO alcanza a otra', () => {
    const prefijo = contabilidadKeys.mapeoDeEmpresa('c1')
    expect(contabilidadKeys.mapeo('c2', 'p1').slice(0, prefijo.length)).not.toEqual([...prefijo])
  })

  it('las cuentas especiales tienen su propio espacio de cache, por ledger', () => {
    expect(contabilidadKeys.cuentasEspeciales('c1', null)).not.toEqual(
      contabilidadKeys.cuentasEspeciales('c1', 'p1'),
    )
    expect(contabilidadKeys.cuentasEspeciales()).toEqual([
      'contabilidad', 'cuentas-especiales', null, null,
    ])
  })
})
