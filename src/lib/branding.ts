// plat:P20 — Helpers PUROS de color de marca (white-label). Validan/normalizan el
// hex y derivan las variantes de tema (hover/soft) para el tema CLARO y el OSCURO.
// Sin DOM → testeable. BrandingApplier inyecta `hojaEstilosMarca(...)` en un
// <style> con selectores claro/oscuro que replican los de src/index.css, así la
// cascada de dark mode sigue funcionando con colores custom.

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

/** Mezcla `a` con `b`: factor 0..1 = proporción de `a` (0.2 = 20% a + 80% b). */
export function mezclar(a: string, b: string, factor: number): string {
  const ra = parseRgb(a), rb = parseRgb(b)
  const f = Math.max(0, Math.min(1, factor))
  return toHex([0, 1, 2].map((i) => ra[i] * f + rb[i] * (1 - f)) as [number, number, number])
}

/** Luminancia relativa WCAG 2.x (0 = negro, 1 = blanco). */
export function luminanciaRelativa(hex: string): number {
  const [r, g, b] = parseRgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Razón de contraste WCAG entre dos colores (1..21). */
export function contraste(a: string, b: string): number {
  const la = luminanciaRelativa(a), lb = luminanciaRelativa(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function rgbAHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return [h / 6, s, l]
}

function hslAHex([h, s, l]: [number, number, number]): string {
  if (s === 0) return toHex([l * 255, l * 255, l * 255])
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const canal = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return toHex([canal(h + 1 / 3) * 255, canal(h) * 255, canal(h - 1 / 3) * 255])
}

/**
 * Sube la luminosidad (HSL, conservando tono y saturación) lo MÍNIMO para que el
 * color cumpla `cumple`. Si ya lo cumple, lo devuelve tal cual. Así la marca sigue
 * reconocible pero se lee sobre fondos oscuros. `cumple` debe aceptar el blanco
 * (cota superior de la búsqueda); el resultado siempre lo cumple.
 */
function aclararHasta(hex: string, cumple: (c: string) => boolean): string {
  const base = normalizarColorHex(hex) ?? (normalizarColorHex(DEFAULT_BRAND_COLOR) as string)
  if (cumple(base)) return base
  const [h, s, l0] = rgbAHsl(parseRgb(base))
  let lo = l0, hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (cumple(hslAHex([h, s, mid]))) hi = mid
    else lo = mid
  }
  return hslAHex([h, s, hi])
}

/** Fondo del tema oscuro (= --at-bg dark en src/index.css). */
export const DARK_BG = '#0B1410'
/** Superficie del tema oscuro (= --at-surface dark en src/index.css). */
export const DARK_SURFACE = '#11201A'
/** Proporción del color en su variante -soft oscura (resto = DARK_BG). */
export const DARK_SOFT_MEZCLA = 0.2
/** Contraste mínimo (WCAG AA texto) del color sobre su propio -soft oscuro. */
export const DARK_MIN_CONTRASTE = 4.5

/** Variante -soft para el tema oscuro: el color mezclado hacia el fondo oscuro. */
export function suaveOscuro(hex: string): string {
  return mezclar(hex, DARK_BG, DARK_SOFT_MEZCLA)
}

/**
 * Aclara un color de marca para el tema oscuro: lo mínimo para leerse como texto
 * (≥ 4.5:1) sobre su propio -soft oscuro, la superficie MÁS clara donde aparece
 * (chips/tiles); con eso también se lee sobre --at-bg/--at-surface, más oscuros.
 * Colores ya claros quedan tal cual.
 */
export function aclararParaTemaOscuro(hex: string): string {
  return aclararHasta(hex, (c) => contraste(c, suaveOscuro(c)) >= DARK_MIN_CONTRASTE)
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

/**
 * Variante para el tema OSCURO (equivalente a los overrides dark de src/index.css):
 * - primary: aclarado hasta leerse sobre fondos oscuros (texto/bordes).
 * - hover: MÁS claro que primary (en dark el hover aclara, no oscurece).
 * - soft: el primario mezclado hacia el FONDO oscuro → superficie oscura teñida
 *   de marca, nunca un tinte casi blanco.
 */
export function derivarVariablesMarcaOscuro(primary: string | null | undefined): VariablesMarca {
  const base = normalizarColorHex(primary) ?? (normalizarColorHex(DEFAULT_BRAND_COLOR) as string)
  const p = aclararParaTemaOscuro(base)
  return {
    primary: p,
    hover: mezclarBlanco(p, 0.2),
    soft: suaveOscuro(p),
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

/** Igual que `estilosMarca` pero con los valores del tema OSCURO; null si no hay color custom. */
export function estilosMarcaOscuro(primaryColor: string | null | undefined): Record<string, string> | null {
  const color = normalizarColorHex(primaryColor)
  if (!color) return null
  const v = derivarVariablesMarcaOscuro(color)
  return {
    '--at-primary': v.primary,
    '--at-primary-hover': v.hover,
    '--at-primary-soft': v.soft,
  }
}

/** Color de acento del tema por defecto (= --at-accent en src/index.css). */
export const DEFAULT_ACCENT_COLOR = '#B96A3F'

/** CSS vars de acento que el branding sobreescribe. */
export const ACCENT_CSS_VARS = ['--at-accent', '--at-accent-hover'] as const

/**
 * Mapa de CSS vars de ACENTO para un color custom, o null si no hay (restablecer).
 * Sobreescribe las 2 vars de acento dominantes; las variantes finas
 * (-soft/-tint/-light/…) quedan en sus defaults (follow-up: derivar la paleta).
 */
export function estilosAccent(accentColor: string | null | undefined): Record<string, string> | null {
  const color = normalizarColorHex(accentColor)
  if (!color) return null
  return {
    '--at-accent': color,
    '--at-accent-hover': oscurecer(color, 0.18),
  }
}

/** Acento para el tema OSCURO: aclarado hasta leerse sobre fondos oscuros; hover aclara. */
export function estilosAccentOscuro(accentColor: string | null | undefined): Record<string, string> | null {
  const color = normalizarColorHex(accentColor)
  if (!color) return null
  const a = aclararParaTemaOscuro(color)
  return {
    '--at-accent': a,
    '--at-accent-hover': mezclarBlanco(a, 0.18),
  }
}

/** id del <style> que BrandingApplier inyecta en <head>. */
export const BRANDING_STYLE_ID = 'at-branding'

function declaraciones(...mapas: (Record<string, string> | null)[]): string {
  return mapas
    .flatMap((m) => (m ? Object.entries(m) : []))
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ')
}

/**
 * Hoja de estilos con los colores de marca para AMBOS temas, o null si no hay
 * ningún color custom (el caller quita la hoja → defaults de src/index.css).
 *
 * Los selectores replican los de src/index.css (auto por prefers-color-scheme
 * salvo [data-theme="light"], y [data-theme="dark"] manual) con `:root:root`
 * para tener MÁS especificidad que los de la hoja base: ganan sin depender del
 * orden de inserción y, a diferencia de un style inline en <html>, el bloque
 * dark sigue ganando al claro cuando el tema es oscuro.
 */
export function hojaEstilosMarca(
  primaryColor: string | null | undefined,
  accentColor: string | null | undefined,
): string | null {
  const claro = declaraciones(estilosMarca(primaryColor), estilosAccent(accentColor))
  const oscuro = declaraciones(estilosMarcaOscuro(primaryColor), estilosAccentOscuro(accentColor))
  if (!claro) return null
  return [
    `:root:root { ${claro} }`,
    `@media (prefers-color-scheme: dark) { :root:root:not([data-theme="light"]) { ${oscuro} } }`,
    `:root:root[data-theme="dark"] { ${oscuro} }`,
  ].join('\n')
}
