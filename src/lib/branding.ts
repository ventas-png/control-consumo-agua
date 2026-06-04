// plat:P20 — Helpers PUROS de color de marca (white-label). Validan/normalizan el
// hex y derivan las variantes de tema (hover/soft). Sin DOM → testeable.

/** Color primario del tema por defecto (= --at-primary en src/index.css). */
export const DEFAULT_BRAND_COLOR = '#1B3B36'

const HEX6 = /^#[0-9a-fA-F]{6}$/
const HEX3 = /^#[0-9a-fA-F]{3}$/

export function esColorHex(s: string | null | undefined): boolean {
  return typeof s === 'string' && (HEX6.test(s.trim()) || HEX3.test(s.trim()))
}

/** Normaliza a #rrggbb en minúsculas; null si no es un hex válido. */
export function normalizarColorHex(s: string | null | undefined): string | null {
  if (typeof s !== 'string') return null
  const t = s.trim()
  if (HEX6.test(t)) return t.toLowerCase()
  if (HEX3.test(t)) {
    const r = t[1], g = t[2], b = t[3]
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return null
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

function parseRgb(hex: string): [number, number, number] {
  const h = normalizarColorHex(hex) ?? DEFAULT_BRAND_COLOR
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((n) => clampByte(n).toString(16).padStart(2, '0')).join('')}`
}

/** Oscurece hacia negro por un factor 0..1 (0.2 = 20% más oscuro). */
export function oscurecer(hex: string, factor: number): string {
  const [r, g, b] = parseRgb(hex)
  const f = Math.max(0, Math.min(1, factor))
  return toHex([r * (1 - f), g * (1 - f), b * (1 - f)])
}

/** Mezcla con blanco por un factor 0..1 (0.85 ≈ casi blanco). */
export function mezclarBlanco(hex: string, factor: number): string {
  const [r, g, b] = parseRgb(hex)
  const f = Math.max(0, Math.min(1, factor))
  return toHex([r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f])
}

export interface VariablesMarca {
  primary: string
  hover: string
  soft: string
}

/** Deriva las variables de tema (--at-primary / -hover / -soft) de un color base. */
export function derivarVariablesMarca(primary: string | null | undefined): VariablesMarca {
  const base = normalizarColorHex(primary) ?? (normalizarColorHex(DEFAULT_BRAND_COLOR) as string)
  return {
    primary: base,
    hover: oscurecer(base, 0.18),
    soft: mezclarBlanco(base, 0.82),
  }
}

/** CSS vars de tema que el branding sobreescribe (en orden). */
export const BRAND_CSS_VARS = ['--at-primary', '--at-primary-hover', '--at-primary-soft'] as const

/**
 * Mapa de CSS vars a aplicar para un color de marca, o null si NO hay color
 * custom (el caller debe entonces RESTABLECER esas vars a las de la hoja de
 * estilos). Puro.
 */
export function estilosMarca(primaryColor: string | null | undefined): Record<string, string> | null {
  const color = normalizarColorHex(primaryColor)
  if (!color) return null
  const v = derivarVariablesMarca(color)
  return {
    '--at-primary': v.primary,
    '--at-primary-hover': v.hover,
    '--at-primary-soft': v.soft,
  }
}
