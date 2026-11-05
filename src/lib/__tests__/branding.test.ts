import { describe, it, expect } from 'vitest'
import {
  esColorHex, normalizarColorHex, oscurecer, mezclarBlanco, mezclar,
  luminanciaRelativa, contraste, aclararParaTemaOscuro, suaveOscuro,
  derivarVariablesMarca, derivarVariablesMarcaOscuro, estilosMarca, estilosMarcaOscuro,
  estilosAccent, estilosAccentOscuro, hojaEstilosMarca,
  DEFAULT_BRAND_COLOR, DEFAULT_ACCENT_COLOR, DARK_BG, DARK_SURFACE, DARK_MIN_CONTRASTE,
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

// ─── Tema oscuro ───────────────────────────────────────────────────────────
// Bug: con color custom, --at-primary-soft (82% blanco) se aplicaba inline en
// :root y ganaba al override dark de src/index.css → superficies casi blancas
// en dark mode. Ahora hay una derivación dark y una hoja con selectores claro/oscuro.

// Muestras: default, acento default, saturados, oscuros, claros y negro/blanco.
const MUESTRAS = [
  DEFAULT_BRAND_COLOR, DEFAULT_ACCENT_COLOR, '#ff0000', '#0033cc', '#7c3aed',
  '#0e7490', '#be123c', '#000000', '#14213d', '#ffd400', '#ffffff', '#c0c0c0',
]

describe('mezclar / luminanciaRelativa / contraste', () => {
  it('mezclar: factor = proporción del primer color', () => {
    expect(mezclar('#ffffff', '#000000', 0.5)).toBe('#808080')
    expect(mezclar('#ff0000', '#0000ff', 1)).toBe('#ff0000')
    expect(mezclar('#ff0000', '#0000ff', 0)).toBe('#0000ff')
  })
  it('luminancia: negro 0, blanco 1', () => {
    expect(luminanciaRelativa('#000000')).toBe(0)
    expect(luminanciaRelativa('#ffffff')).toBeCloseTo(1, 6)
  })
  it('contraste: blanco/negro = 21, simétrico, igual = 1', () => {
    expect(contraste('#ffffff', '#000000')).toBeCloseTo(21, 6)
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 6)
    expect(contraste('#1b3b36', '#1b3b36')).toBe(1)
  })
})

describe('aclararParaTemaOscuro', () => {
  it('un color oscuro se aclara hasta leerse sobre su -soft oscuro (≥ 4.5:1)', () => {
    const p = aclararParaTemaOscuro('#1B3B36')
    expect(luminanciaRelativa(p)).toBeGreaterThan(luminanciaRelativa('#1b3b36'))
    expect(contraste(p, suaveOscuro(p))).toBeGreaterThanOrEqual(DARK_MIN_CONTRASTE)
  })
  it('un color ya claro queda igual', () => {
    expect(aclararParaTemaOscuro('#FFD400')).toBe('#ffd400')
    expect(aclararParaTemaOscuro('#ffffff')).toBe('#ffffff')
  })
  it('conserva el tono (rojo sigue rojo, azul sigue azul)', () => {
    const rojo = aclararParaTemaOscuro('#cc0000')
    expect(parseInt(rojo.slice(1, 3), 16)).toBeGreaterThan(parseInt(rojo.slice(3, 5), 16))
    const azul = aclararParaTemaOscuro('#0033cc')
    expect(parseInt(azul.slice(5, 7), 16)).toBeGreaterThan(parseInt(azul.slice(1, 3), 16))
  })
  it('inválido → usa el color por defecto (no lanza)', () => {
    expect(aclararParaTemaOscuro('basura')).toBe(aclararParaTemaOscuro(DEFAULT_BRAND_COLOR))
  })
})

describe('derivarVariablesMarcaOscuro', () => {
  it.each(MUESTRAS)('%s → soft es una superficie OSCURA (no un tinte casi blanco)', (c) => {
    const d = derivarVariablesMarcaOscuro(c)
    // El bug: soft claro ≈ luminancia > 0.6. Una superficie dark ronda 0.01–0.05.
    expect(luminanciaRelativa(d.soft)).toBeLessThan(0.06)
    // Texto claro de dark mode (--at-ink #ECEFE8) se lee sobre el soft.
    expect(contraste('#ECEFE8', d.soft)).toBeGreaterThanOrEqual(DARK_MIN_CONTRASTE)
    // Y el soft oscuro es mucho más oscuro que el soft claro (salvo blanco puro).
    if (c !== '#ffffff') expect(luminanciaRelativa(d.soft)).toBeLessThan(luminanciaRelativa(derivarVariablesMarca(c).soft))
  })
  it.each(MUESTRAS)('%s → primary se lee sobre fondos oscuros y sobre su soft', (c) => {
    const d = derivarVariablesMarcaOscuro(c)
    expect(contraste(d.primary, d.soft)).toBeGreaterThanOrEqual(DARK_MIN_CONTRASTE)
    expect(contraste(d.primary, DARK_SURFACE)).toBeGreaterThanOrEqual(DARK_MIN_CONTRASTE)
    expect(contraste(d.primary, DARK_BG)).toBeGreaterThanOrEqual(DARK_MIN_CONTRASTE)
  })
  it.each(MUESTRAS.filter((c) => c !== '#ffffff'))('%s → hover es MÁS claro que primary (dark aclara)', (c) => {
    const d = derivarVariablesMarcaOscuro(c)
    expect(luminanciaRelativa(d.hover)).toBeGreaterThan(luminanciaRelativa(d.primary))
  })
  it('el color por defecto da valores cercanos a los dark de src/index.css', () => {
    const d = derivarVariablesMarcaOscuro(DEFAULT_BRAND_COLOR)
    // index.css dark: --at-primary #5E9D8A, --at-primary-soft #1C2E27
    expect(contraste(d.primary, '#5E9D8A')).toBeLessThan(1.3)
    expect(contraste(d.soft, '#1C2E27')).toBeLessThan(1.15)
  })
  it('null/inválido → cae al color por defecto', () => {
    expect(derivarVariablesMarcaOscuro(null)).toEqual(derivarVariablesMarcaOscuro(DEFAULT_BRAND_COLOR))
  })
})

describe('estilosMarcaOscuro / estilosAccentOscuro', () => {
  it('null/inválido → null', () => {
    expect(estilosMarcaOscuro(null)).toBeNull()
    expect(estilosMarcaOscuro('rojo')).toBeNull()
    expect(estilosAccentOscuro(undefined)).toBeNull()
  })
  it('mismas claves que la versión clara', () => {
    expect(Object.keys(estilosMarcaOscuro('#1B3B36')!)).toEqual(Object.keys(estilosMarca('#1B3B36')!))
    expect(Object.keys(estilosAccentOscuro('#B96A3F')!)).toEqual(Object.keys(estilosAccent('#B96A3F')!))
  })
  it('acento oscuro se lee sobre la superficie dark y su hover aclara', () => {
    const m = estilosAccentOscuro('#7E461F')!
    expect(contraste(m['--at-accent'], DARK_SURFACE)).toBeGreaterThanOrEqual(DARK_MIN_CONTRASTE)
    expect(luminanciaRelativa(m['--at-accent-hover'])).toBeGreaterThan(luminanciaRelativa(m['--at-accent']))
  })
})

describe('hojaEstilosMarca', () => {
  it('sin colores custom → null (quitar la hoja)', () => {
    expect(hojaEstilosMarca(null, null)).toBeNull()
    expect(hojaEstilosMarca('rojo', undefined)).toBeNull()
  })

  it('el tema CLARO no cambia: mismos valores que estilosMarca/estilosAccent', () => {
    const css = hojaEstilosMarca('#1B3B36', '#B96A3F')!
    const claro = css.split('\n')[0]
    expect(claro.startsWith(':root:root {')).toBe(true)
    for (const [k, v] of Object.entries({ ...estilosMarca('#1B3B36'), ...estilosAccent('#B96A3F') })) {
      expect(claro).toContain(`${k}: ${v};`)
    }
    // Light soft sigue siendo el tinte 82% blanco de siempre.
    expect(claro).toContain(`--at-primary-soft: ${mezclarBlanco('#1b3b36', 0.82)};`)
  })

  it('el tema OSCURO usa la derivación dark en ambos selectores (auto y manual)', () => {
    const css = hojaEstilosMarca('#ff0000', null)!
    const dark = estilosMarcaOscuro('#ff0000')!
    const lineas = css.split('\n')
    const auto = lineas.find((l) => l.startsWith('@media (prefers-color-scheme: dark) { :root:root:not([data-theme="light"])'))
    const manual = lineas.find((l) => l.startsWith(':root:root[data-theme="dark"]'))
    expect(auto).toBeDefined()
    expect(manual).toBeDefined()
    for (const l of [auto!, manual!]) {
      for (const [k, v] of Object.entries(dark)) expect(l).toContain(`${k}: ${v};`)
      expect(l).not.toContain(estilosMarca('#ff0000')!['--at-primary-soft'])
    }
    // Sin acento custom no se tocan las vars de acento.
    expect(css).not.toContain('--at-accent')
  })

  it('solo acento → sólo vars de acento', () => {
    const css = hojaEstilosMarca(null, '#00ff00')!
    expect(css).toContain('--at-accent: #00ff00;')
    expect(css).not.toContain('--at-primary')
  })
})

