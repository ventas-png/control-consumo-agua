// F3.16: WCAG color contrast helpers
// Implementa el algoritmo de relative luminance + contrast ratio del
// WCAG 2.1, equivalente al check 'color-contrast' de axe-core.
//
// Por qué un helper propio en vez de jest-axe color-contrast:
// jsdom no computa los valores de var(--at-*), por lo que axe-core no
// puede medir contrast en unit tests. Aquí extraemos los tokens del
// :root del CSS y verificamos los pares foreground/background que la
// app usa en componentes críticos (botones, texto sobre tints, etc.).

/** Convierte un color #RRGGBB o #RGB a [R, G, B] en rango 0-1. */
export function parseHex(hex: string): [number, number, number] {
  let m = hex.trim().replace('#', '')
  if (m.length === 3) {
    // Expand shorthand: #abc → #aabbcc
    m = m[0] + m[0] + m[1] + m[1] + m[2] + m[2]
  }
  if (m.length !== 6) throw new Error(`Hex inválido: ${hex}`)
  const r = parseInt(m.slice(0, 2), 16) / 255
  const g = parseInt(m.slice(2, 4), 16) / 255
  const b = parseInt(m.slice(4, 6), 16) / 255
  return [r, g, b]
}

/** Channel relative luminance per WCAG 2.1. */
function chan(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Relative luminance L según WCAG 2.1. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex)
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
}

/** Contrast ratio entre dos colores. Mínimo 1, máximo 21. */
export function contrastRatio(fg: string, bg: string): number {
  const L1 = luminance(fg)
  const L2 = luminance(bg)
  const lighter = Math.max(L1, L2)
  const darker = Math.min(L1, L2)
  return (lighter + 0.05) / (darker + 0.05)
}

/** WCAG AA: 4.5:1 normal text, 3:1 large text (≥18pt o 14pt bold). */
export const WCAG_AA_NORMAL = 4.5
export const WCAG_AA_LARGE = 3.0
/** WCAG AAA: 7:1 normal text, 4.5:1 large text. */
export const WCAG_AAA_NORMAL = 7.0
export const WCAG_AAA_LARGE = 4.5

export function meetsAA(fg: string, bg: string, large = false): boolean {
  return contrastRatio(fg, bg) >= (large ? WCAG_AA_LARGE : WCAG_AA_NORMAL)
}
