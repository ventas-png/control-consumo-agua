import { describe, it, expect } from 'vitest'
import { resolveChartColor, chartFill } from '../chartColors'

describe('resolveChartColor', () => {
  it('deja pasar colores literales sin tocar', () => {
    expect(resolveChartColor('#1B3B36')).toBe('#1B3B36')
    expect(resolveChartColor('rgba(1,2,3,0.5)')).toBe('rgba(1,2,3,0.5)')
  })

  it('resuelve un token var(--at-x) desde :root cuando está definido', () => {
    document.documentElement.style.setProperty('--at-primary', '#123456')
    expect(resolveChartColor('var(--at-primary)')).toBe('#123456')
    document.documentElement.style.removeProperty('--at-primary')
  })

  it('cae al token si la variable no está definida', () => {
    expect(resolveChartColor('var(--at-inexistente)')).toBe('var(--at-inexistente)')
  })
})

describe('chartFill', () => {
  it('convierte hex a rgba con la opacidad dada', () => {
    expect(chartFill('#1b3b36', 0.1)).toBe('rgba(27, 59, 54, 0.1)')
    expect(chartFill('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)')
  })

  it('convierte rgb/rgba a rgba reemplazando la opacidad', () => {
    expect(chartFill('rgb(16,185,129)', 0.2)).toBe('rgba(16, 185, 129, 0.2)')
    expect(chartFill('rgba(1, 2, 3, 0.9)', 0.3)).toBe('rgba(1, 2, 3, 0.3)')
  })

  it('resuelve el token antes de aplicar alfa', () => {
    document.documentElement.style.setProperty('--at-success', '#10b981')
    expect(chartFill('var(--at-success)', 0.1)).toBe('rgba(16, 185, 129, 0.1)')
    document.documentElement.style.removeProperty('--at-success')
  })

  it('acota la opacidad a [0,1]', () => {
    expect(chartFill('#000', 2)).toBe('rgba(0, 0, 0, 1)')
    expect(chartFill('#000', -1)).toBe('rgba(0, 0, 0, 0)')
  })

  it('devuelve el color resuelto si no puede parsear', () => {
    expect(chartFill('papayawhip', 0.5)).toBe('papayawhip')
  })
})
