import { describe, it, expect } from 'vitest'
import { resolveMapCenter, DEFAULT_CENTER, DEFAULT_ZOOM } from '../mapCenter'

describe('resolveMapCenter (serv:S16)', () => {
  it('config completa del tenant → su centro y zoom', () => {
    expect(resolveMapCenter({ center_lat: 19.43, center_lng: -99.13, zoom_default: 15 }))
      .toEqual({ center: [19.43, -99.13], zoom: 15 })
  })

  it('sin empresa → fallback Guatemala', () => {
    expect(resolveMapCenter()).toEqual({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM })
    expect(resolveMapCenter(null)).toEqual({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM })
  })

  it('lat/lng incompletos o nulos → centro de fallback (zoom independiente)', () => {
    expect(resolveMapCenter({ center_lat: 19.4, center_lng: null, zoom_default: 16 }))
      .toEqual({ center: DEFAULT_CENTER, zoom: 16 })
    expect(resolveMapCenter({ center_lat: null, center_lng: null }))
      .toEqual({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM })
  })

  it('zoom configurado pero sin coords → centro fallback + ese zoom', () => {
    expect(resolveMapCenter({ zoom_default: 10 })).toEqual({ center: DEFAULT_CENTER, zoom: 10 })
  })

  it('valores no finitos (NaN) → fallback', () => {
    expect(resolveMapCenter({ center_lat: NaN, center_lng: NaN, zoom_default: NaN }))
      .toEqual({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM })
  })
})
