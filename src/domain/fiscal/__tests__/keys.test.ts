import { describe, it, expect } from 'vitest'
import { fiscalKeys } from '../keys'

describe('fiscalKeys', () => {
  it('expone una raíz estable para invalidación masiva del dominio', () => {
    expect(fiscalKeys.all).toEqual(['fiscal'])
  })

  it('documentos scopea por companyId', () => {
    expect(fiscalKeys.documentos('c1')).toEqual(['fiscal', 'documentos', 'c1'])
  })

  it('normaliza companyId ausente a null (key estable)', () => {
    expect(fiscalKeys.documentos()).toEqual(['fiscal', 'documentos', null])
  })

  it('documentosPorRegistro scopea por registroId', () => {
    expect(fiscalKeys.documentosPorRegistro('reg-1')).toEqual([
      'fiscal',
      'documentos',
      'por-registro',
      'reg-1',
    ])
  })

  it('documento scopea por id', () => {
    expect(fiscalKeys.documento('d1')).toEqual(['fiscal', 'documento', 'd1'])
    expect(fiscalKeys.documento()).toEqual(['fiscal', 'documento', null])
  })
})
