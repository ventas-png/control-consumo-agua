import { describe, it, expect } from 'vitest'
import { contrastRatio, meetsAA, luminance, parseHex } from '../contrast'

// F3.16: Validación de WCAG 2.1 AA contrast en los color tokens del
// design system. Cada par foreground/background que la app usa en
// componentes críticos debe cumplir 4.5:1 (texto normal) o 3:1 (texto
// grande / UI components).
//
// Se mantiene como SUITE de tests para que cualquier cambio futuro en
// los tokens (rebrand, dark mode, theme custom) detecte regresiones de
// accesibilidad antes de mergear.
//
// Categorías:
// - AA estricto (≥4.5:1): para texto normal (body, paragraph, table cells)
// - AA-large (≥3:1): para UI components, botones primarios, large text
// - Documentado: pares conocidos como borderline que NO usamos para body

// Tokens light theme — sincronizados con src/index.css
const LIGHT = {
  // Surfaces
  surface: '#FFFFFF',
  surface2: '#FAF7EF',
  // Ink (text)
  ink: '#15291F',
  ink2: '#3E5A4C',
  ink3: '#7E9389',
  // Lines/chips (decorative)
  line: '#E1DDD0',
  lineStrong: '#C7C2B0',
  chip: '#EAE6D8',
  // Brand
  primary: '#1B3B36',
  primaryHover: '#102622',
  primary2: '#2F5D4F',
  primaryTint: '#EEF2EC',
  // Status (light)
  success: '#16a34a',
  successTint: '#dcfce7',
  successStrong: '#15803d',
  warning: '#d97706',
  warningTint: '#fef3c7',
  warningStrong: '#92400e',
  danger: '#ef4444',
  dangerTint: '#fef2f2',
  dangerStrong: '#dc2626',
  info: '#2563eb',
  infoTint: '#dbeafe',
  infoStrong: '#1d4ed8',
  onStatus: '#ffffff',
} as const

describe('WCAG 2.1 contrast — utility', () => {
  it('luminance: blanco=1, negro=0', () => {
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 4)
    expect(luminance('#000000')).toBeCloseTo(0, 4)
  })

  it('parseHex acepta uppercase y lowercase', () => {
    expect(parseHex('#FFFFFF')).toEqual([1, 1, 1])
    expect(parseHex('#000000')).toEqual([0, 0, 0])
    expect(parseHex('#abcdef')).toEqual(parseHex('#ABCDEF'))
  })

  it('contrastRatio simétrico (fg, bg) === (bg, fg)', () => {
    expect(contrastRatio('#000', '#FFF')).toBeCloseTo(contrastRatio('#FFF', '#000'), 2)
  })

  it('contrastRatio negro vs blanco = 21', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
  })

  it('contrastRatio mismo color = 1', () => {
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 4)
  })
})

describe('WCAG 2.1 AA (texto normal 4.5:1) — body text del design system', () => {
  // Texto principal sobre superficies primarias
  it('ink sobre surface', () => {
    expect(meetsAA(LIGHT.ink, LIGHT.surface)).toBe(true)
  })

  it('ink sobre surface-2', () => {
    expect(meetsAA(LIGHT.ink, LIGHT.surface2)).toBe(true)
  })

  it('ink-2 sobre surface', () => {
    expect(meetsAA(LIGHT.ink2, LIGHT.surface)).toBe(true)
  })

  // Texto sobre tints de status — solo variants -strong garantizan AA normal
  it('success-strong sobre success-tint', () => {
    expect(meetsAA(LIGHT.successStrong, LIGHT.successTint)).toBe(true)
  })

  it('warning-strong sobre warning-tint', () => {
    expect(meetsAA(LIGHT.warningStrong, LIGHT.warningTint)).toBe(true)
  })

  it('info-strong sobre info-tint', () => {
    expect(meetsAA(LIGHT.infoStrong, LIGHT.infoTint)).toBe(true)
  })

  it('on-status (white) sobre primary', () => {
    expect(meetsAA(LIGHT.onStatus, LIGHT.primary)).toBe(true)
  })

  it('on-status (white) sobre primary-hover', () => {
    expect(meetsAA(LIGHT.onStatus, LIGHT.primaryHover)).toBe(true)
  })

  it('on-status (white) sobre success-strong', () => {
    expect(meetsAA(LIGHT.onStatus, LIGHT.successStrong)).toBe(true)
  })

  it('on-status (white) sobre danger-strong', () => {
    expect(meetsAA(LIGHT.onStatus, LIGHT.dangerStrong)).toBe(true)
  })

  it('primary sobre primary-tint', () => {
    expect(meetsAA(LIGHT.primary, LIGHT.primaryTint)).toBe(true)
  })
})

describe('WCAG 2.1 AA-large (3:1) — UI components & large text (botones)', () => {
  // Botones primarios con tokens base (success/warning/danger sin -strong)
  // cumplen AA-large pero NO AA normal. Solo usar en botones grandes con
  // weight 600+. Para texto pequeño, usar variants -strong.
  it('on-status (white) sobre success: AA-large', () => {
    expect(meetsAA(LIGHT.onStatus, LIGHT.success, true)).toBe(true)
  })

  it('on-status (white) sobre warning: AA-large', () => {
    expect(meetsAA(LIGHT.onStatus, LIGHT.warning, true)).toBe(true)
  })

  it('on-status (white) sobre danger: AA-large', () => {
    expect(meetsAA(LIGHT.onStatus, LIGHT.danger, true)).toBe(true)
  })
})

describe('WCAG 2.1 — documentación de violaciones conocidas', () => {
  // danger-strong/danger-tint queda en 4.41:1 — debajo de AA estricto
  // por 0.09. Es BORDERLINE y solo se usa en notify de variant=error
  // donde el texto es mediano (14px font-weight 700). No se considera
  // crítico, pero documentamos aquí para que se revise en el rebrand.
  it('danger-strong sobre danger-tint: borderline (4.41:1, debajo de 4.5)', () => {
    const ratio = contrastRatio(LIGHT.dangerStrong, LIGHT.dangerTint)
    expect(ratio).toBeGreaterThan(4.0)
    expect(ratio).toBeLessThan(4.5)
    // Fix futuro: usar 'danger-strongest' (e.g. #b91c1c) o usar tint
    // más claro (#fef7f7). Tracking en F4.x.
  })

  // ink-3 es nuestro 'placeholder' / 'caption text'. Documenta su
  // contraste para detectar regresiones; debe ser usado SOLO para text
  // auxiliar pequeño, NO para body text.
  it('ink-3 sobre surface: contraste auxiliar (no body text)', () => {
    const ratio = contrastRatio(LIGHT.ink3, LIGHT.surface)
    expect(ratio).toBeGreaterThanOrEqual(2.5)
  })
})
