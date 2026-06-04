import { describe, it, expect } from 'vitest'
import { empresaKeys } from '../keys'

describe('empresaKeys', () => {
  it('expone una raíz estable para invalidación masiva del dominio', () => {
    expect(empresaKeys.all).toEqual(['empresa'])
  })

  it('seccion scopea por companyId', () => {
    expect(empresaKeys.seccion('c1')).toEqual(['empresa', 'seccion', 'c1'])
  })

  it('normaliza companyId ausente a null para que la key sea estable', () => {
    expect(empresaKeys.seccion()).toEqual(['empresa', 'seccion', null])
  })

  it('la key con scope comparte el prefijo de la raíz', () => {
    expect(empresaKeys.seccion('c1').slice(0, 1)).toEqual([...empresaKeys.all])
  })

  it('cambiar el companyId produce una key distinta (cache aislado por tenant)', () => {
    expect(empresaKeys.seccion('c1')).not.toEqual(empresaKeys.seccion('c2'))
  })
})
