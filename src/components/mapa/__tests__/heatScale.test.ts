import { describe, it, expect } from 'vitest'
import { normalizar, heatStyle } from '../heatScale'

describe('normalizar (serv:S18)', () => {
  it('mapea min→0, max→1 y el punto medio→0.5', () => {
    expect(normalizar(0, 0, 10)).toBe(0)
    expect(normalizar(10, 0, 10)).toBe(1)
    expect(normalizar(5, 0, 10)).toBe(0.5)
  })
  it('rango plano (min==max) → 0.5', () => {
    expect(normalizar(7, 7, 7)).toBe(0.5)
  })
  it('clampa fuera de rango a [0,1]', () => {
    expect(normalizar(-5, 0, 10)).toBe(0)
    expect(normalizar(99, 0, 10)).toBe(1)
  })
})

describe('heatStyle (serv:S18)', () => {
  it('peso mínimo → azul (hue 240), radio y opacidad mínimos', () => {
    expect(heatStyle(0, 0, 10)).toEqual({ color: 'hsl(240, 90%, 50%)', radius: 14, fillOpacity: 0.35 })
  })
  it('peso máximo → rojo (hue 0), radio y opacidad máximos', () => {
    expect(heatStyle(10, 0, 10)).toEqual({ color: 'hsl(0, 90%, 50%)', radius: 30, fillOpacity: 0.7 })
  })
  it('punto medio → hue 120 (verde) y valores intermedios', () => {
    const s = heatStyle(5, 0, 10)
    expect(s.color).toBe('hsl(120, 90%, 50%)')
    expect(s.radius).toBeCloseTo(22)
    expect(s.fillOpacity).toBeCloseTo(0.525)
  })
})
