import { describe, it, expect } from 'vitest'
import { MONEDAS_ISO, monedaLabel } from '../monedas'

describe('MONEDAS_ISO', () => {
  it('los códigos son ISO-3 en minúsculas y únicos', () => {
    const codes = MONEDAS_ISO.map(m => m.code)
    expect(codes.every(c => /^[a-z]{3}$/.test(c))).toBe(true)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('incluye las monedas clave del mercado (GTQ y USD)', () => {
    const codes = MONEDAS_ISO.map(m => m.code)
    expect(codes).toContain('gtq')
    expect(codes).toContain('usd')
  })
})

describe('monedaLabel', () => {
  it('resuelve la etiqueta del catálogo (case-insensitive)', () => {
    expect(monedaLabel('gtq')).toContain('Quetzal')
    expect(monedaLabel('GTQ')).toContain('Quetzal')
  })

  it('cae al código en mayúsculas si no está en el catálogo', () => {
    expect(monedaLabel('xaf')).toBe('XAF')
  })

  it('null/undefined → em dash', () => {
    expect(monedaLabel(null)).toBe('—')
    expect(monedaLabel(undefined)).toBe('—')
  })
})
