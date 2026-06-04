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

  it('configEfectiva scopea por companyId + projectId (override por locación)', () => {
    expect(fiscalKeys.configEfectiva('c1', 'p1')).toEqual([
      'fiscal',
      'config-efectiva',
      'c1',
      'p1',
    ])
    // projectId ausente = config a nivel empresa (key estable).
    expect(fiscalKeys.configEfectiva('c1')).toEqual([
      'fiscal',
      'config-efectiva',
      'c1',
      null,
    ])
    expect(fiscalKeys.configEfectiva()).toEqual([
      'fiscal',
      'config-efectiva',
      null,
      null,
    ])
  })

  it('credenciales scopea por companyId (estatus, no el secreto)', () => {
    expect(fiscalKeys.credenciales('c1')).toEqual(['fiscal', 'credenciales', 'c1'])
    expect(fiscalKeys.credenciales()).toEqual(['fiscal', 'credenciales', null])
  })
})
