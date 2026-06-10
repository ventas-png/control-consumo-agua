import { describe, it, expect } from 'vitest'
import { bancosKeys } from '../keys'

describe('bancosKeys', () => {
  it('expone una raíz estable para invalidación masiva del dominio', () => {
    expect(bancosKeys.all).toEqual(['bancos'])
  })

  it('movimientos scopea por cuenta bancaria y estado', () => {
    expect(bancosKeys.movimientos('cb1', 'pendiente')).toEqual([
      'bancos', 'movimientos', 'cb1', 'pendiente',
    ])
  })

  it('normaliza scope ausente a null', () => {
    expect(bancosKeys.cuentas()).toEqual(['bancos', 'cuentas', null])
    expect(bancosKeys.movimientos()).toEqual(['bancos', 'movimientos', null, null])
    expect(bancosKeys.estadoConciliacion()).toEqual(['bancos', 'estado-conciliacion', null, null])
  })

  it('todas las entidades comparten el prefijo de la raíz', () => {
    expect(bancosKeys.sugerencias('cb1').slice(0, 1)).toEqual([...bancosKeys.all])
  })
})
