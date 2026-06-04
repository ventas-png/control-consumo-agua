import { describe, it, expect } from 'vitest'
import { condominiosKeys } from '../keys'

describe('condominiosKeys', () => {
  it('expone una raíz estable para invalidación masiva del dominio', () => {
    expect(condominiosKeys.all).toEqual(['condominios'])
  })

  it('cuotas scopea por companyId', () => {
    expect(condominiosKeys.cuotas('c1')).toEqual(['condominios', 'cuotas', 'c1'])
  })

  it('recargosMora scopea por companyId', () => {
    expect(condominiosKeys.recargosMora('c1')).toEqual(['condominios', 'recargos-mora', 'c1'])
  })

  it('cuotasPorProyecto incluye companyId y projectId en el scope', () => {
    expect(condominiosKeys.cuotasPorProyecto('c1', 'p1')).toEqual([
      'condominios', 'cuotas', 'por-proyecto', 'c1', 'p1',
    ])
  })

  it('normaliza scope ausente a null para que la key sea estable', () => {
    expect(condominiosKeys.cuotas()).toEqual(['condominios', 'cuotas', null])
    expect(condominiosKeys.cuotasPorProyecto()).toEqual([
      'condominios', 'cuotas', 'por-proyecto', null, null,
    ])
  })

  it('todas las entidades comparten el prefijo de la raíz', () => {
    expect(condominiosKeys.cuotas('c1').slice(0, 1)).toEqual([...condominiosKeys.all])
    expect(condominiosKeys.recargosMora('c1').slice(0, 1)).toEqual([...condominiosKeys.all])
  })

  it('cambiar un parámetro del scope produce una key distinta (cache aislado)', () => {
    expect(condominiosKeys.cuotasPorProyecto('c1', 'p1')).not.toEqual(
      condominiosKeys.cuotasPorProyecto('c1', 'p2'),
    )
  })
})
