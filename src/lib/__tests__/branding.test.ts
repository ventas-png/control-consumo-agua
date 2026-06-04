import { describe, it, expect } from 'vitest'
import {
  esColorHex, normalizarColorHex, oscurecer, mezclarBlanco,
  derivarVariablesMarca, estilosMarca, estilosAccent, DEFAULT_BRAND_COLOR,
} from '../branding'

// plat:P20 — Helpers de color de marca (puros, deterministas).

describe('esColorHex', () => {
  it('acepta #rrggbb y #rgb', () => {
    expect(esColorHex('#1B3B36')).toBe(true)
    expect(esColorHex('#abc')).toBe(true)
  })
  it('rechaza nombres, sin #, longitud incorrecta, null', () => {
    expect(esColorHex('red')).toBe(false)
    expect(esColorHex('1B3B36')).toBe(false)
    expect(esColorHex('#12345')).toBe(false)
    expect(esColorHex(null)).toBe(false)
    expect(esColorHex(undefined)).toBe(false)
  })
})

describe('normalizarColorHex', () => {
  it('#RRGGBB → minúsculas', () => {
    expect(normalizarColorHex('#1B3B36')).toBe('#1b3b36')
  })
  it('#RGB → expande a #rrggbb', () => {
    expect(normalizarColorHex('#ABC')).toBe('#aabbcc')
  })
  it('inválido → null', () => {
    expect(normalizarColorHex('rojo')).toBeNull()
    expect(normalizarColorHex('')).toBeNull()
    expect(normalizarColorHex(null)).toBeNull()
  })
})

describe('oscurecer', () => {
  it('50% de blanco → gris medio', () => {
    expect(oscurecer('#ffffff', 0.5)).toBe('#808080')
  })
  it('negro permanece negro; factor se acota a 0..1', () => {
    expect(oscurecer('#000000', 0.5)).toBe('#000000')
    expect(oscurecer('#ffffff', 0)).toBe('#ffffff')
    expect(oscurecer('#ffffff', 5)).toBe('#000000')
  })
})

describe('mezclarBlanco', () => {
  it('50% de negro → gris medio', () => {
    expect(mezclarBlanco('#000000', 0.5)).toBe('#808080')
  })
  it('blanco permanece blanco', () => {
    expect(mezclarBlanco('#ffffff', 0.5)).toBe('#ffffff')
  })
})

describe('derivarVariablesMarca', () => {
  it('color válido → primary normalizado + hover más oscuro + soft más claro', () => {
    const v = derivarVariablesMarca('#1B3B36')
    expect(v.primary).toBe('#1b3b36')
    expect(v.hover).not.toBe(v.primary)
    expect(v.soft).not.toBe(v.primary)
  })
  it('null/inválido → cae al color por defecto del tema', () => {
    expect(derivarVariablesMarca(null).primary).toBe(DEFAULT_BRAND_COLOR.toLowerCase())
    expect(derivarVariablesMarca('basura').primary).toBe(DEFAULT_BRAND_COLOR.toLowerCase())
  })
})

describe('estilosMarca', () => {
  it('null/inválido → null (señal de restablecer a los defaults)', () => {
    expect(estilosMarca(null)).toBeNull()
    expect(estilosMarca(undefined)).toBeNull()
    expect(estilosMarca('rojo')).toBeNull()
  })
  it('color válido → mapa con las 3 CSS vars de marca', () => {
    const m = estilosMarca('#1B3B36')
    expect(m).not.toBeNull()
    expect(m!['--at-primary']).toBe('#1b3b36')
    expect(Object.keys(m!)).toEqual(['--at-primary', '--at-primary-hover', '--at-primary-soft'])
  })
})

describe('estilosAccent', () => {
  it('null/inválido → null', () => {
    expect(estilosAccent(null)).toBeNull()
    expect(estilosAccent('nope')).toBeNull()
  })
  it('color válido → --at-accent + --at-accent-hover', () => {
    const m = estilosAccent('#B96A3F')
    expect(m).not.toBeNull()
    expect(m!['--at-accent']).toBe('#b96a3f')
    expect(Object.keys(m!)).toEqual(['--at-accent', '--at-accent-hover'])
  })
})
