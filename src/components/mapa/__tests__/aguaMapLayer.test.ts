import { describe, it, expect } from 'vitest'
import { buildMedidoresLayer, colorPorEstado, bucketEstado, type EstadoBucket } from '../aguaMapLayer'
import type { Cliente, Registro } from '../../../types'

// El builder solo lee un subconjunto de campos; casteamos literales mínimos.
const cliente = (id: string, nombre: string): Cliente =>
  ({ id, nombre } as unknown as Cliente)

const registro = (r: {
  cliente_id: string
  fecha: string
  estado: string
  consumo?: number
  gps?: { lat: number; lng: number } | null
}): Registro => (r as unknown as Registro)

describe('colorPorEstado (serv:S13)', () => {
  it('mapea estado de cobro → color de pin', () => {
    expect(colorPorEstado('mora')).toBe('red')
    expect(colorPorEstado('pendiente')).toBe('gold')
    expect(colorPorEstado('pagado')).toBe('green')
    expect(colorPorEstado('cualquier_otro')).toBe('green')
  })
})

describe('buildMedidoresLayer (serv:S13)', () => {
  it('la capa siempre se identifica como "medidores"', () => {
    expect(buildMedidoresLayer([], []).id).toBe('medidores')
  })

  it('un cliente con lectura GPS → un pin en esa posición y color por estado', () => {
    const layer = buildMedidoresLayer(
      [cliente('c1', 'Casa 1')],
      [registro({ cliente_id: 'c1', fecha: '2026-05-01', estado: 'mora', consumo: 12, gps: { lat: 14.6, lng: -90.5 } })],
    )
    expect(layer.markers).toHaveLength(1)
    expect(layer.markers[0]).toMatchObject({ id: 'c1', lat: 14.6, lng: -90.5, color: 'red' })
  })

  it('usa la ÚLTIMA lectura por fecha para posición y estado', () => {
    const layer = buildMedidoresLayer(
      [cliente('c1', 'Casa 1')],
      [
        registro({ cliente_id: 'c1', fecha: '2026-01-10', estado: 'mora', consumo: 5, gps: { lat: 1, lng: 1 } }),
        registro({ cliente_id: 'c1', fecha: '2026-05-20', estado: 'pagado', consumo: 9, gps: { lat: 2, lng: 2 } }),
      ],
    )
    expect(layer.markers).toHaveLength(1)
    expect(layer.markers[0]).toMatchObject({ lat: 2, lng: 2, color: 'green' })
  })

  it('omite clientes sin lecturas o sin GPS', () => {
    const layer = buildMedidoresLayer(
      [cliente('c1', 'Sin lecturas'), cliente('c2', 'Sin GPS')],
      [registro({ cliente_id: 'c2', fecha: '2026-05-01', estado: 'pendiente', consumo: 3, gps: null })],
    )
    expect(layer.markers).toHaveLength(0)
  })

  it('el popup incluye nombre del cliente y consumo', () => {
    const layer = buildMedidoresLayer(
      [cliente('c1', 'Familia Pérez')],
      [registro({ cliente_id: 'c1', fecha: '2026-05-01', estado: 'pendiente', consumo: 27, gps: { lat: 0, lng: 0 } })],
    )
    expect(layer.markers[0].popupHtml).toContain('Familia Pérez')
    expect(layer.markers[0].popupHtml).toContain('27')
  })
})

describe('bucketEstado (serv:S17)', () => {
  it('mora/pendiente a su bucket; el resto a pagado', () => {
    expect(bucketEstado('mora')).toBe('mora')
    expect(bucketEstado('pendiente')).toBe('pendiente')
    expect(bucketEstado('pagado')).toBe('pagado')
    expect(bucketEstado('verificacion')).toBe('pagado')
  })
})

describe('buildMedidoresLayer — filtro por estado (serv:S17)', () => {
  const clientes = [cliente('m', 'Mora'), cliente('p', 'Pendiente'), cliente('g', 'Pagado')]
  const registros = [
    registro({ cliente_id: 'm', fecha: '2026-05-01', estado: 'mora', gps: { lat: 1, lng: 1 } }),
    registro({ cliente_id: 'p', fecha: '2026-05-01', estado: 'pendiente', gps: { lat: 2, lng: 2 } }),
    registro({ cliente_id: 'g', fecha: '2026-05-01', estado: 'pagado', gps: { lat: 3, lng: 3 } }),
  ]

  it('sin filtro → todos los pines', () => {
    expect(buildMedidoresLayer(clientes, registros).markers).toHaveLength(3)
  })

  it('solo el estado activo se incluye', () => {
    const layer = buildMedidoresLayer(clientes, registros, new Set<EstadoBucket>(['mora']))
    expect(layer.markers.map(m => m.id)).toEqual(['m'])
  })

  it('varios estados activos', () => {
    const layer = buildMedidoresLayer(clientes, registros, new Set<EstadoBucket>(['mora', 'pagado']))
    expect(layer.markers.map(m => m.id).sort()).toEqual(['g', 'm'])
  })

  it('set vacío → ningún pin', () => {
    expect(buildMedidoresLayer(clientes, registros, new Set<EstadoBucket>()).markers).toHaveLength(0)
  })
})
