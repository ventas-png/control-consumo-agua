import { describe, it, expect } from 'vitest'
import { aguaKeys } from '../keys'

describe('aguaKeys', () => {
  it('expone una raíz estable para invalidación masiva del dominio', () => {
    expect(aguaKeys.all).toEqual(['agua'])
  })

  it('incluye el companyId en el scope de cada entidad', () => {
    expect(aguaKeys.clientes('c1')).toEqual(['agua', 'clientes', 'c1'])
    expect(aguaKeys.registros('c1')).toEqual(['agua', 'registros', 'c1'])
    expect(aguaKeys.rutas('c1')).toEqual(['agua', 'rutas', 'c1'])
  })

  it('normaliza companyId ausente a null para que la key sea estable', () => {
    expect(aguaKeys.clientes()).toEqual(['agua', 'clientes', null])
  })

  it('todas las entidades comparten el prefijo de la raíz', () => {
    expect(aguaKeys.clientes('c1').slice(0, 1)).toEqual([...aguaKeys.all])
    expect(aguaKeys.registros('c1').slice(0, 1)).toEqual([...aguaKeys.all])
  })

  it('las keys con scope incluyen todos los parámetros del scope', () => {
    expect(aguaKeys.contadoresPorProyecto('c1', 'p1')).toEqual([
      'agua', 'contadores', 'por-proyecto', 'c1', 'p1',
    ])
    expect(aguaKeys.consumoPorProyecto('p1', '2026-06')).toEqual([
      'agua', 'registros', 'consumo-por-proyecto', 'p1', '2026-06',
    ])
    expect(aguaKeys.consumoMensualPorProyecto('p1')).toEqual([
      'agua', 'registros', 'consumo-mensual-por-proyecto', 'p1',
    ])
    expect(aguaKeys.medidoresAguaPorProyecto('c1', 'p1')).toEqual([
      'agua', 'medidores-agua', 'por-proyecto', 'c1', 'p1',
    ])
  })

  it('cambiar un parámetro del scope produce una key distinta (cache aislado)', () => {
    expect(aguaKeys.consumoPorProyecto('p1', '2026-06')).not.toEqual(
      aguaKeys.consumoPorProyecto('p1', '2026-07'),
    )
  })
})
