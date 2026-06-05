// T7/PR3 — Tests del parse PURO de la config de mapa (serv:S16), extraído de
// MapaSection junto con su acceso a datos.
import { describe, it, expect } from 'vitest'
import { parseMapCenter } from '../schemas'

describe('parseMapCenter', () => {
  it('fila válida → config', () => {
    expect(parseMapCenter({ center_lat: 14.6, center_lng: -90.5, zoom_default: 13 })).toEqual({
      center_lat: 14.6,
      center_lng: -90.5,
      zoom_default: 13,
    })
  })

  it('columnas nulas (empresa sin centro fijado) → config con nulls (resolveMapCenter degrada)', () => {
    expect(parseMapCenter({ center_lat: null, center_lng: null, zoom_default: null })).toEqual({
      center_lat: null,
      center_lng: null,
      zoom_default: null,
    })
  })

  it('fila ausente (null/undefined) → null', () => {
    expect(parseMapCenter(null)).toBeNull()
    expect(parseMapCenter(undefined)).toBeNull()
  })

  it('malformada (tipos incorrectos) → null (degrada al default, no rompe el mapa)', () => {
    expect(parseMapCenter({ center_lat: 'x', center_lng: -90.5, zoom_default: 13 })).toBeNull()
    expect(parseMapCenter('nonsense')).toBeNull()
  })

  it('ignora columnas extra de la fila', () => {
    expect(parseMapCenter({ center_lat: 1, center_lng: 2, zoom_default: 3, id: 'abc', nombre: 'X' })).toEqual({
      center_lat: 1,
      center_lng: 2,
      zoom_default: 3,
    })
  })
})
