import { describe, it, expect } from 'vitest'
import {
  esColorHex, normalizarColorHex, oscurecer, mezclarBlanco, mezclar,
  luminanciaRelativa, contraste, aclararParaTemaOscuro, suaveOscuro,
  derivarVariablesMarca, derivarVariablesMarcaOscuro, estilosMarca, estilosMarcaOscuro,
  estilosAccent, estilosAccentOscuro, hojaEstilosMarca,
  DEFAULT_BRAND_COLOR, DEFAULT_ACCENT_COLOR, DARK_BG, DARK_SURFACE, DARK_MIN_CONTRASTE,
  LIGHT_MIN_CONTRASTE, BRAND_CSS_VARS, ACCENT_CSS_VARS,
  derivarVariablesAccent, derivarVariablesAccentOscuro,
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
  it('color válido → mapa con las 8 CSS vars de marca', () => {
    const m = estilosMarca('#1B3B36')
    expect(m).not.toBeNull()
    expect(m!['--at-primary']).toBe('#1b3b36')
    expect(Object.keys(m!)).toEqual([
      '--at-primary', '--at-primary-hover', '--at-primary-soft', '--at-primary-2',
      '--at-primary-tint', '--at-primary-soft-2', '--at-primary-mint', '--at-primary-mint-2',
    ])
    expect(Object.keys(m!)).toEqual([...BRAND_CSS_VARS])
  })
})

describe('estilosAccent', () => {
  it('null/inválido → null', () => {
    expect(estilosAccent(null)).toBeNull()
    expect(estilosAccent('nope')).toBeNull()
  })
  it('color válido → las 10 CSS vars de acento (incluida --at-accent-2)', () => {
    const m = estilosAccent('#B96A3F')
    expect(m).not.toBeNull()
    expect(m!['--at-accent']).toBe('#b96a3f')
    expect(Object.keys(m!)).toEqual([
      '--at-accent', '--at-accent-hover', '--at-accent-dark', '--at-accent-darker', '--at-accent-light',
      '--at-accent-soft', '--at-accent-soft-2', '--at-accent-tint', '--at-accent-tint-2', '--at-accent-2',
    ])
    expect(Object.keys(m!)).toEqual([...ACCENT_CSS_VARS])
  })
})

// ─── Tonos derivados (primary-2 / tint / soft-2 / mint / mint-2) ───────────
// Antes sólo se derivaban primary/hover/soft; el resto quedaba en el verde por
// defecto aunque la empresa tuviera otro color de marca.

/** Distancia euclídea en RGB (0..441): ≤ ~16 es casi indistinguible a la vista. */
function distanciaRgb(a: string, b: string): number {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(normalizarColorHex(h)!.slice(i, i + 2), 16))
  const x = p(a), y = p(b)
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

const L = luminanciaRelativa

describe('derivarVariablesMarca — tonos derivados (tema claro)', () => {
  it('con el color por defecto reproduce (casi) la paleta clara de src/index.css', () => {
    const v = derivarVariablesMarca(DEFAULT_BRAND_COLOR)
    const indexCss = { soft: '#D9E2DC', primary2: '#2F5D4F', tint: '#EEF2EC', soft2: '#C2D2CA', mint: '#9CC6B6', mint2: '#7FB29F' }
    for (const [k, hex] of Object.entries(indexCss)) {
      expect(distanciaRgb(v[k as keyof typeof v], hex), k).toBeLessThan(16)
    }
  })

  it('sigue a la marca: con otro color los tonos cambian', () => {
    const def = derivarVariablesMarca(DEFAULT_BRAND_COLOR)
    const v = derivarVariablesMarca('#7c3aed')
    for (const k of ['primary2', 'tint', 'soft2', 'mint', 'mint2'] as const) expect(v[k]).not.toBe(def[k])
    // y conservan el tono: morado → azul > verde
    for (const k of ['primary2', 'tint', 'soft2', 'mint', 'mint2'] as const) {
      expect(parseInt(v[k].slice(5, 7), 16), k).toBeGreaterThan(parseInt(v[k].slice(3, 5), 16))
    }
  })

  it.each(MUESTRAS.filter((c) => c !== '#ffffff'))('%s → orden de fondos: tint > soft > soft-2 (más claro a más oscuro)', (c) => {
    const v = derivarVariablesMarca(c)
    expect(L(v.tint)).toBeGreaterThan(L(v.soft))
    expect(L(v.soft)).toBeGreaterThan(L(v.soft2))
  })

  it.each(MUESTRAS)('%s → mint / mint-2 son tonos medios (ni casi blancos ni casi negros)', (c) => {
    const v = derivarVariablesMarca(c)
    for (const m of [v.mint, v.mint2]) {
      expect(L(m)).toBeGreaterThan(0.15)
      expect(L(m)).toBeLessThan(0.7)
    }
    expect(L(v.mint)).toBeGreaterThan(L(v.mint2))
  })

  it.each(MUESTRAS)('%s → primary-2 aclara sin perder legibilidad sobre el tint', (c) => {
    const v = derivarVariablesMarca(c)
    expect(L(v.primary2)).toBeGreaterThanOrEqual(L(v.primary))
    if (contraste(v.primary, v.tint) >= LIGHT_MIN_CONTRASTE) {
      expect(contraste(v.primary2, v.tint)).toBeGreaterThanOrEqual(LIGHT_MIN_CONTRASTE)
    } else {
      // la marca ya no llega: no se empeora
      expect(v.primary2).toBe(v.primary)
    }
  })
})

// ─── Tonos de ACENTO (dark / darker / light / soft / soft-2 / tint / tint-2) ─
describe('derivarVariablesAccent — tonos derivados (tema claro)', () => {
  it('con el acento por defecto reproduce (casi) la paleta clara de src/index.css', () => {
    const v = derivarVariablesAccent(DEFAULT_ACCENT_COLOR)
    const indexCss = {
      hover: '#9C5733', dark: '#7E461F', darker: '#5E3417', light: '#CE8A63',
      soft: '#E6CDBB', soft2: '#EFE0D5', tint: '#F4EBE3', tint2: '#FAF1EA',
    }
    for (const [k, hex] of Object.entries(indexCss)) {
      expect(distanciaRgb(v[k as keyof typeof v], hex), k).toBeLessThan(16)
    }
  })

  it('sigue al acento y conserva su tono (azul petróleo → azul > rojo)', () => {
    const def = derivarVariablesAccent(DEFAULT_ACCENT_COLOR)
    const v = derivarVariablesAccent('#0e7490')
    for (const k of ['dark', 'darker', 'light', 'soft', 'soft2', 'tint', 'tint2'] as const) {
      expect(v[k], k).not.toBe(def[k])
      expect(parseInt(v[k].slice(5, 7), 16), k).toBeGreaterThan(parseInt(v[k].slice(1, 3), 16))
    }
  })

  it.each(MUESTRAS.filter((c) => c !== '#ffffff'))('%s → orden de fondos: tint-2 > tint > soft-2 > soft', (c) => {
    const v = derivarVariablesAccent(c)
    expect(L(v.tint2)).toBeGreaterThan(L(v.tint))
    expect(L(v.tint)).toBeGreaterThan(L(v.soft2))
    expect(L(v.soft2)).toBeGreaterThan(L(v.soft))
  })

  it.each(MUESTRAS)('%s → dark / darker (texto) se leen sobre los tints y darker ≤ dark', (c) => {
    const v = derivarVariablesAccent(c)
    for (const t of [v.dark, v.darker]) {
      expect(contraste(t, v.tint)).toBeGreaterThanOrEqual(LIGHT_MIN_CONTRASTE)
      expect(contraste(t, v.tint2)).toBeGreaterThanOrEqual(LIGHT_MIN_CONTRASTE)
    }
    expect(L(v.darker)).toBeLessThanOrEqual(L(v.dark))
  })
})

// --at-accent-2: por defecto verde salvia (#577B69 / #79A18E). Con acento custom
// se deriva con el tono del acento y el mismo peso apagado que el salvia.
const SALVIA = '#577B69', SALVIA_DARK = '#79A18E'
/** Diferencia entre el canal máximo y el mínimo: 0 = gris, 255 = saturado puro. */
const croma = (h: string) => {
  const ch = [1, 3, 5].map((i) => parseInt(normalizarColorHex(h)!.slice(i, i + 2), 16))
  return Math.max(...ch) - Math.min(...ch)
}

describe('--at-accent-2 — acento secundario apagado, derivado del acento', () => {
  it('sigue el tono del acento: verde → casi el salvia por defecto, azul petróleo → azul apagado', () => {
    expect(distanciaRgb(derivarVariablesAccent('#22c55e').accent2, SALVIA)).toBeLessThan(16)
    const azul = derivarVariablesAccent('#0e7490').accent2
    expect(parseInt(azul.slice(5, 7), 16)).toBeGreaterThan(parseInt(azul.slice(1, 3), 16))
  })

  // Sólo colores con croma: un gris ya no puede apagarse más.
  it.each(MUESTRAS.filter((c) => croma(c) > 0))('%s → es apagado (menos croma que el acento) en ambos temas', (c) => {
    expect(croma(derivarVariablesAccent(c).accent2)).toBeLessThan(croma(derivarVariablesAccent(c).accent))
    expect(croma(derivarVariablesAccentOscuro(c).accent2)).toBeLessThan(croma(derivarVariablesAccentOscuro(c).accent))
  })

  it.each(MUESTRAS)('%s → claro: ≥ 4.5:1 contra blanco (texto, y relleno con texto blanco)', (c) => {
    expect(contraste(derivarVariablesAccent(c).accent2, '#ffffff')).toBeGreaterThanOrEqual(LIGHT_MIN_CONTRASTE)
  })

  it.each(MUESTRAS)('%s → oscuro: se lee sobre la superficie y los tints oscuros, y es más claro que en el tema claro', (c) => {
    const d = derivarVariablesAccentOscuro(c)
    for (const f of [DARK_SURFACE, DARK_BG, d.tint, d.tint2]) expect(contraste(d.accent2, f)).toBeGreaterThanOrEqual(DARK_MIN_CONTRASTE)
    expect(L(d.accent2)).toBeGreaterThan(L(derivarVariablesAccent(c).accent2))
  })

  it('mismo peso que el salvia: luminancia parecida en ambos temas', () => {
    expect(contraste(derivarVariablesAccent(DEFAULT_ACCENT_COLOR).accent2, SALVIA)).toBeLessThan(1.25)
    expect(contraste(derivarVariablesAccentOscuro(DEFAULT_ACCENT_COLOR).accent2, SALVIA_DARK)).toBeLessThan(1.25)
  })
})

describe('derivarVariablesAccentOscuro — tonos derivados (tema oscuro)', () => {
  it('con el acento por defecto queda cerca de la paleta dark de src/index.css (marrones, no oliva)', () => {
    const d = derivarVariablesAccentOscuro(DEFAULT_ACCENT_COLOR)
    const indexCss = {
      accent: '#C8865C', hover: '#D49A72', dark: '#C8865C', darker: '#B5764A', light: '#D9A580',
      soft: '#2E2018', soft2: '#3A2A20', tint: '#1F1610', tint2: '#261A12',
    }
    for (const [k, hex] of Object.entries(indexCss)) {
      expect(distanciaRgb(d[k as keyof typeof d], hex), k).toBeLessThan(20)
    }
    // superficies cálidas: rojo > verde > azul
    for (const k of ['soft', 'soft2', 'tint', 'tint2'] as const) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(d[k].slice(i, i + 2), 16))
      expect(r, k).toBeGreaterThan(g)
      expect(g, k).toBeGreaterThan(b)
    }
  })

  it.each(MUESTRAS)('%s → tint / tint-2 / soft / soft-2 son superficies OSCURAS, en orden', (c) => {
    const d = derivarVariablesAccentOscuro(c)
    for (const f of [d.tint, d.tint2, d.soft]) expect(L(f)).toBeLessThan(0.06)
    expect(L(d.soft2)).toBeLessThan(0.1)
    for (const f of [d.tint, d.tint2, d.soft, d.soft2]) expect(contraste('#ECEFE8', f)).toBeGreaterThanOrEqual(DARK_MIN_CONTRASTE)
    expect(L(d.tint)).toBeLessThan(L(d.tint2))
    expect(L(d.tint2)).toBeLessThan(L(d.soft))
    expect(L(d.soft)).toBeLessThan(L(d.soft2))
  })

  it.each(MUESTRAS)('%s → dark / darker (texto) se leen sobre tint / tint-2 / soft oscuros', (c) => {
    const d = derivarVariablesAccentOscuro(c)
    for (const t of [d.dark, d.darker]) {
      for (const f of [d.tint, d.tint2, d.soft]) expect(contraste(t, f)).toBeGreaterThanOrEqual(DARK_MIN_CONTRASTE)
    }
  })

  it.each(MUESTRAS.filter((c) => c !== '#ffffff'))('%s → hover y light son más claros que el acento (dark aclara)', (c) => {
    const d = derivarVariablesAccentOscuro(c)
    expect(L(d.hover)).toBeGreaterThan(L(d.accent))
    expect(L(d.light)).toBeGreaterThan(L(d.hover))
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
  it.each(MUESTRAS)('%s → tint y soft-2 también son superficies OSCURAS, en orden tint < soft < soft-2', (c) => {
    const d = derivarVariablesMarcaOscuro(c)
    // tint es fondo (como soft); soft-2 es sobre todo borde, algo más claro.
    expect(L(d.tint)).toBeLessThan(0.06)
    expect(L(d.soft2)).toBeLessThan(0.12)
    for (const f of [d.tint, d.soft2]) expect(contraste('#ECEFE8', f)).toBeGreaterThanOrEqual(DARK_MIN_CONTRASTE)
    expect(L(d.tint)).toBeLessThan(L(d.soft))
    expect(L(d.soft)).toBeLessThan(L(d.soft2))
  })
  it.each(MUESTRAS)('%s → primary-2 (texto) se lee sobre soft y tint oscuros; mint = hover, mint-2 = primary-2', (c) => {
    const d = derivarVariablesMarcaOscuro(c)
    expect(contraste(d.primary2, d.soft)).toBeGreaterThanOrEqual(DARK_MIN_CONTRASTE)
    expect(contraste(d.primary2, d.tint)).toBeGreaterThanOrEqual(DARK_MIN_CONTRASTE)
    expect(d.mint).toBe(d.hover)
    expect(d.mint2).toBe(d.primary2)
  })
  it('primary-2 oscuro es una variante más apagada, no una copia de primary', () => {
    const d = derivarVariablesMarcaOscuro(DEFAULT_BRAND_COLOR)
    expect(d.primary2).not.toBe(d.primary)
  })
  it('el color por defecto da valores cercanos a los dark de src/index.css', () => {
    const d = derivarVariablesMarcaOscuro(DEFAULT_BRAND_COLOR)
    // index.css dark: --at-primary #5E9D8A, --at-primary-soft #1C2E27
    expect(contraste(d.primary, '#5E9D8A')).toBeLessThan(1.3)
    expect(contraste(d.soft, '#1C2E27')).toBeLessThan(1.15)
    const indexCss = { soft: '#1C2E27', primary2: '#62927F', tint: '#16241D', soft2: '#2A3D33', mint: '#76B3A1', mint2: '#62927F' }
    for (const [k, hex] of Object.entries(indexCss)) {
      expect(distanciaRgb(d[k as keyof typeof d], hex), k).toBeLessThan(32)
    }
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
      for (const k of BRAND_CSS_VARS) expect(l).toContain(`${k}: ${dark[k]};`)
      // ningún tinte claro (soft / tint / soft-2) se cuela en el bloque oscuro
      const claro = estilosMarca('#ff0000')!
      for (const k of ['--at-primary-soft', '--at-primary-tint', '--at-primary-soft-2']) expect(l).not.toContain(claro[k])
    }
    // Sin acento custom no se tocan las vars de acento.
    expect(css).not.toContain('--at-accent')
  })

  it('con acento custom, el bloque OSCURO lleva las 10 vars de acento oscuras', () => {
    const css = hojaEstilosMarca(null, '#0e7490')!
    const dark = estilosAccentOscuro('#0e7490')!
    const claro = estilosAccent('#0e7490')!
    const lineas = css.split('\n').slice(1)
    expect(lineas).toHaveLength(2)
    for (const l of lineas) {
      for (const k of ACCENT_CSS_VARS) expect(l).toContain(`${k}: ${dark[k]};`)
      for (const k of ['--at-accent-soft', '--at-accent-soft-2', '--at-accent-tint', '--at-accent-tint-2']) expect(l).not.toContain(claro[k])
    }
  })

  it('solo acento → sólo vars de acento', () => {
    const css = hojaEstilosMarca(null, '#00ff00')!
    expect(css).toContain('--at-accent: #00ff00;')
    expect(css).not.toContain('--at-primary')
  })
})

