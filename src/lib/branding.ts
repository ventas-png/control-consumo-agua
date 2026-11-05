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
  /** --at-primary: botones, enlaces, texto de marca. */
  primary: string
  /** --at-primary-hover */
  hover: string
  /** --at-primary-soft: fondo suave de marca (tiles, chips). */
  soft: string
  /** --at-primary-2: variante secundaria (texto, puntos, barras). */
  primary2: string
  /** --at-primary-tint: fondo aún más suave que soft (filas, tarjetas, botones). */
  tint: string
  /** --at-primary-soft-2: bordes de superficies soft/tint. */
  soft2: string
  /** --at-primary-mint: tono medio-claro (bordes, gradientes). */
  mint: string
  /** --at-primary-mint-2: tono medio (barras de progreso). */
  mint2: string
  /** --at-chip: superficie NEUTRA (~640 usos: botones secundarios, pestañas
   *  inactivas, inputs deshabilitados, avatares, divisores) con texto --at-ink-2. */
  chip: string
  /** --at-surface-tint: superficie apenas teñida (también --at-table-header-bg,
   *  el encabezado fijo de DataTable: debe ser opaco). */
  surfaceTint: string
}

/** Fondo del tema claro (= --at-bg en src/index.css). */
export const LIGHT_BG = '#F2EFE7'
/** Proporción de marca en --at-chip (resto = fondo de página), claro / oscuro. */
const CHIP_MEZCLA_CLARO = 0.06
const CHIP_MEZCLA_OSCURO = 0.16
/**
 * Proporción de marca en --at-surface-tint (resto = fondo de página). index.css
 * lo define como color-mix(--at-accent-2 8%, --at-bg); con estas proporciones
 * y el color por defecto da casi lo mismo (#E6E6DD / #141F1A).
 */
const SURFACE_TINT_MEZCLA_CLARO = 0.05
const SURFACE_TINT_MEZCLA_OSCURO = 0.075

/** Mismo tono; luminosidad HSL `l` (0..1) y saturación × `factorSat`. */
function enLuminosidad(hex: string, l: number, factorSat = 1): string {
  const [h, s] = rgbAHsl(parseRgb(hex))
  return hslAHex([h, Math.min(1, s * factorSat), Math.max(0, Math.min(1, l))])
}

function luminosidadHsl(hex: string): number {
  return rgbAHsl(parseRgb(hex))[2]
}

/**
 * Aclara (HSL, mismo tono y saturación) hasta `deltaMax`, pero sólo mientras siga
 * cumpliendo `cumple`; si el color ya no lo cumple, lo deja como está.
 */
function aclararMientras(hex: string, deltaMax: number, cumple: (c: string) => boolean): string {
  const l0 = luminosidadHsl(hex)
  const tope = enLuminosidad(hex, l0 + deltaMax)
  if (cumple(tope)) return tope
  if (!cumple(hex)) return hex
  let lo = 0, hi = deltaMax
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (cumple(enLuminosidad(hex, l0 + mid))) lo = mid
    else hi = mid
  }
  return enLuminosidad(hex, l0 + lo)
}

/** Contraste mínimo (WCAG AA texto) de primary-2 sobre su -tint claro. */
export const LIGHT_MIN_CONTRASTE = 4.5

/**
 * Deriva las variables de tema CLARO de un color base. Las proporciones salen de
 * la paleta por defecto de src/index.css (con #1B3B36 dan valores casi iguales):
 * - hover: 18% más oscuro; soft / tint / soft-2: mezcla con blanco 82 / 92 / 74%.
 * - primary-2: mismo tono, hasta +10% de luminosidad, sin bajar de 4.5:1 sobre el
 *   tint (se usa como texto; si la marca ya está por debajo, queda igual).
 * - mint / mint-2: mismo tono, luminosidad fija 69 / 60% y saturación atenuada,
 *   para que sigan siendo tonos medios aunque la marca sea muy oscura o muy clara.
 * - chip / surface-tint: 6 / 5% de la marca sobre el fondo de página (como
 *   index.css arma --at-surface-tint): siguen siendo neutros, apenas teñidos.
 */
export function derivarVariablesMarca(primary: string | null | undefined): VariablesMarca {
  const base = normalizarColorHex(primary) ?? (normalizarColorHex(DEFAULT_BRAND_COLOR) as string)
  const tint = mezclarBlanco(base, 0.92)
  return {
    primary: base,
    hover: oscurecer(base, 0.18),
    soft: mezclarBlanco(base, 0.82),
    primary2: aclararMientras(base, 0.1, (c) => contraste(c, tint) >= LIGHT_MIN_CONTRASTE),
    tint,
    soft2: mezclarBlanco(base, 0.74),
    mint: enLuminosidad(base, 0.69, 0.72),
    mint2: enLuminosidad(base, 0.6, 0.68),
    chip: mezclar(base, LIGHT_BG, CHIP_MEZCLA_CLARO),
    surfaceTint: mezclar(base, LIGHT_BG, SURFACE_TINT_MEZCLA_CLARO),
  }
}

/**
 * Variante para el tema OSCURO (equivalente a los overrides dark de src/index.css):
 * - primary: aclarado hasta leerse sobre fondos oscuros (texto/bordes).
 * - hover: MÁS claro que primary (en dark el hover aclara, no oscurece).
 * - soft / tint / soft-2: el primario mezclado hacia el FONDO oscuro (20 / 12 /
 *   30%) → superficies oscuras teñidas de marca, nunca tintes casi blancos. Como
 *   en index.css, tint es más oscuro que soft y soft-2 (bordes) algo más claro.
 * - primary-2: el primary oscuro con 25% menos saturación (más apagado, como en
 *   index.css), aclarado de nuevo si hace falta para leerse (se usa como texto).
 * - mint = hover y mint-2 = primary-2, igual que en el dark de index.css.
 * - chip / surface-tint: el primario oscuro 16 / 7.5% sobre el fondo oscuro.
 */
export function derivarVariablesMarcaOscuro(primary: string | null | undefined): VariablesMarca {
  const base = normalizarColorHex(primary) ?? (normalizarColorHex(DEFAULT_BRAND_COLOR) as string)
  const p = aclararParaTemaOscuro(base)
  const hover = mezclarBlanco(p, 0.2)
  const primary2 = aclararParaTemaOscuro(enLuminosidad(p, luminosidadHsl(p), 0.75))
  return {
    primary: p,
    hover,
    soft: suaveOscuro(p),
    primary2,
    tint: mezclar(p, DARK_BG, 0.12),
    soft2: mezclar(p, DARK_BG, 0.3),
    mint: hover,
    mint2: primary2,
    chip: mezclar(p, DARK_BG, CHIP_MEZCLA_OSCURO),
    surfaceTint: mezclar(p, DARK_BG, SURFACE_TINT_MEZCLA_OSCURO),
  }
}

/** CSS vars de tema que el branding sobreescribe (en orden). */
const TONOS_MARCA_VARS = [
  '--at-primary', '--at-primary-hover', '--at-primary-soft', '--at-primary-2',
  '--at-primary-tint', '--at-primary-soft-2', '--at-primary-mint', '--at-primary-mint-2', '--at-chip',
  '--at-surface-tint',
] as const

/** Tokens de estado que también siguen a la marca (ver derivarEstados). */
export const ESTADO_CSS_VARS = [
  '--at-success', '--at-success-tint', '--at-success-border', '--at-success-strong',
  '--at-info', '--at-info-tint', '--at-info-border', '--at-info-strong',
] as const

/** CSS vars de tema que el branding sobreescribe (en orden): tonos de marca + estados. */
export const BRAND_CSS_VARS = [...TONOS_MARCA_VARS, ...ESTADO_CSS_VARS] as const

// ─── Estados success / info ─────────────────────────────────────────────────
// info toma el TONO de la marca (avisos neutros en color de marca). success
// conserva el tono verde por defecto (142°) para que siempre se lea como éxito
// (~1600 usos: pagado, activo, guardado…), pero su saturación y luminosidad de
// partida se ajustan a las de la marca: una marca viva da un verde vivo, una
// apagada uno apagado. Con el color por defecto, success reproduce el de
// index.css. Mismos mínimos de contraste que src/test/__tests__/contrast.test.ts:
// strong sobre tint ≥ 4.5, blanco sobre strong ≥ 4.5 y blanco sobre la base ≥ 3
// (AA-large); en dark, la base y strong ≥ 4.5 sobre la superficie y su tint.

/** HSL del success por defecto (#16a34a) y de la marca por defecto (#1B3B36). */
const SUCCESS_TONO = 142 / 360
const SUCCESS_SAT = 0.76
const SUCCESS_LUM = 0.36
const MARCA_SAT = 0.37
const MARCA_LUM = 0.17
/** HSL del info por defecto (#2563eb): para marcas grises / negras, que no tienen tono. */
const INFO_TONO = 221 / 360
const INFO_SAT = 0.83
/** Por debajo de esta saturación HSL la marca se trata como gris (sin tono que heredar). */
const SAT_GRIS = 0.08
/**
 * Tonos (grados) de los estados con significado propio: danger (#ef4444), warning
 * (#d97706) y success. Si el tono de la marca cae a menos de ESTADO_DISTANCIA_MIN de
 * alguno, info usaría un color que se confunde con ese estado (marca roja → «Aviso»
 * igual que «Vencido»), así que vuelve al azul por defecto.
 */
const TONOS_ESTADO = [0, 32, 142]
const ESTADO_DISTANCIA_MIN = 30
const distanciaTono = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))
/** Mínimos de contraste (WCAG) de los estados, como en contrast.test.ts. */
const AA = 4.5
const AA_GRANDE = 3

/** Baja la luminosidad HSL (mismo tono y saturación) lo MÍNIMO para cumplir `cumple`. */
function oscurecerHslHasta(hex: string, cumple: (c: string) => boolean): string {
  if (cumple(hex)) return hex
  const [h, s, l0] = rgbAHsl(parseRgb(hex))
  let lo = 0, hi = l0 // lo cumple (negro), hi no
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (cumple(hslAHex([h, s, mid]))) lo = mid
    else hi = mid
  }
  return hslAHex([h, s, lo])
}

const acotar = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x))

interface PaletaEstado { base: string; tint: string; border: string; strong: string }

/**
 * Paleta de un estado (base / tint / border / strong) para claro y oscuro a partir
 * de un tono, una saturación y una luminosidad de partida. Las proporciones salen
 * de las paletas de estado de index.css (tint 86% / border 72% blanco en claro;
 * en dark, superficies con el mismo tono al 12 / 20% de luminosidad).
 */
function paletaEstado(h: number, s: number, l: number): { claro: PaletaEstado; oscuro: PaletaEstado } {
  const blanco = '#ffffff'
  const base = oscurecerHslHasta(hslAHex([h, s, l]), (c) => contraste(blanco, c) >= AA_GRANDE)
  const tint = mezclarBlanco(base, 0.86)
  const strong = oscurecerHslHasta(oscurecer(base, 0.2), (c) => contraste(c, tint) >= AA && contraste(blanco, c) >= AA)

  // Dark: base clara y saturada como los *-400 de index.css; superficies del mismo tono.
  const tintOsc = enLuminosidad(base, 0.12, 0.55)
  const baseOsc = aclararHasta(enLuminosidad(base, 0.6), (c) => contraste(c, DARK_SURFACE) >= AA && contraste(c, tintOsc) >= AA)
  const strongOsc = aclararHasta(enLuminosidad(baseOsc, 0.76), (c) => contraste(c, tintOsc) >= AA)
  return {
    claro: { base, tint, border: mezclarBlanco(base, 0.72), strong },
    oscuro: { base: baseOsc, tint: enLuminosidad(baseOsc, 0.12, 0.55), border: enLuminosidad(baseOsc, 0.2, 0.55), strong: strongOsc },
  }
}

/**
 * success / info derivados del color de marca, para claro y oscuro (claves de
 * ESTADO_CSS_VARS). success: tono verde fijo; saturación = la por defecto escalada
 * por la saturación de la marca (acotada a 0.4–0.85) y luminosidad de partida que
 * sigue la de la marca (acotada a 0.3–0.45). info: el tono de la marca, con su
 * saturación acotada a 0.45–0.9 para que se lea como aviso. Vuelve al azul por
 * defecto si la marca es gris o negra (sin tono: HSL daría 0° = rojo, que se leería
 * como error) o si su tono choca con danger / warning / success (TONOS_ESTADO); en
 * ese caso conserva la saturación ajustada a la marca.
 */
export function derivarEstados(primary: string | null | undefined): { claro: Record<string, string>; oscuro: Record<string, string> } {
  const base = normalizarColorHex(primary) ?? (normalizarColorHex(DEFAULT_BRAND_COLOR) as string)
  const [h, s, l] = rgbAHsl(parseRgb(base))
  const success = paletaEstado(
    SUCCESS_TONO,
    acotar((SUCCESS_SAT * s) / MARCA_SAT, 0.4, 0.85),
    acotar(SUCCESS_LUM + (l - MARCA_LUM) * 0.3, 0.3, 0.45),
  )
  const choca = TONOS_ESTADO.some((t) => distanciaTono(h * 360, t) < ESTADO_DISTANCIA_MIN)
  const info = s < SAT_GRIS
    ? paletaEstado(INFO_TONO, INFO_SAT, 0.53)
    : paletaEstado(choca ? INFO_TONO : h, acotar(s, 0.45, 0.9), choca ? 0.53 : 0.5)
  const vars = (sc: PaletaEstado, inf: PaletaEstado): Record<string, string> => ({
    '--at-success': sc.base, '--at-success-tint': sc.tint, '--at-success-border': sc.border, '--at-success-strong': sc.strong,
    '--at-info': inf.base, '--at-info-tint': inf.tint, '--at-info-border': inf.border, '--at-info-strong': inf.strong,
  })
  return { claro: vars(success.claro, info.claro), oscuro: vars(success.oscuro, info.oscuro) }
}

function varsMarca(v: VariablesMarca): Record<(typeof TONOS_MARCA_VARS)[number], string> {
  return {
    '--at-primary': v.primary,
    '--at-primary-hover': v.hover,
    '--at-primary-soft': v.soft,
    '--at-primary-2': v.primary2,
    '--at-primary-tint': v.tint,
    '--at-primary-soft-2': v.soft2,
    '--at-primary-mint': v.mint,
    '--at-primary-mint-2': v.mint2,
    '--at-chip': v.chip,
    '--at-surface-tint': v.surfaceTint,
  }
}

/**
 * Mapa de CSS vars a aplicar para un color de marca, o null si NO hay color
 * custom (el caller debe entonces RESTABLECER esas vars a las de la hoja de
 * estilos). Puro.
 */
export function estilosMarca(primaryColor: string | null | undefined): Record<string, string> | null {
  const color = normalizarColorHex(primaryColor)
  return color ? { ...varsMarca(derivarVariablesMarca(color)), ...derivarEstados(color).claro } : null
}

/** Igual que `estilosMarca` pero con los valores del tema OSCURO; null si no hay color custom. */
export function estilosMarcaOscuro(primaryColor: string | null | undefined): Record<string, string> | null {
  const color = normalizarColorHex(primaryColor)
  return color ? { ...varsMarca(derivarVariablesMarcaOscuro(color)), ...derivarEstados(color).oscuro } : null
}

/** Color de acento del tema por defecto (= --at-accent en src/index.css). */
export const DEFAULT_ACCENT_COLOR = '#B96A3F'

export interface VariablesAccent {
  /** --at-accent: acento de marca (botones secundarios, destacados). */
  accent: string
  /** --at-accent-hover */
  hover: string
  /** --at-accent-dark / -darker: texto de acento sobre sus fondos claros. */
  dark: string
  darker: string
  /** --at-accent-light: tono medio-claro (fondos, texto, bordes). */
  light: string
  /** --at-accent-soft / -soft-2: bordes de acento. */
  soft: string
  soft2: string
  /** --at-accent-tint / -tint-2: fondos de acento (~160 usos). */
  tint: string
  tint2: string
  /** --at-accent-2: acento secundario apagado (texto, rellenos, gráficas, bordes de selección). */
  accent2: string
}

/**
 * --at-accent-2 por defecto es un verde salvia (#577B69 / dark #79A18E): un tono
 * medio y APAGADO. Con acento custom se deriva con el MISMO tono del acento (para
 * no inventar un color ajeno a la marca) y el mismo peso que el salvia: la
 * saturación del acento × 0.35 (salvia ≈ 0.17 vs terracota ≈ 0.49) y luminosidad
 * HSL 41% (claro) / 55% (oscuro).
 */
const ACCENT2_SATURACION = 0.35

/**
 * Menor factor de `oscurecer` ≥ `desde` con el que el color cumple `cumple`
 * (1 = negro si nada antes lo cumple).
 */
function factorOscurecerHasta(hex: string, desde: number, cumple: (c: string) => boolean): number {
  if (cumple(oscurecer(hex, desde))) return desde
  let lo = desde, hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (cumple(oscurecer(hex, mid))) hi = mid
    else lo = mid
  }
  return hi
}

/** Oscurece lo MÍNIMO para cumplir `cumple` (nada si ya lo cumple). */
function oscurecerHasta(hex: string, cumple: (c: string) => boolean): string {
  return oscurecer(hex, factorOscurecerHasta(hex, 0, cumple))
}

/**
 * Deriva la paleta de ACENTO del tema CLARO. Proporciones sacadas de la paleta
 * por defecto de src/index.css (con #B96A3F da valores casi iguales):
 * - hover / dark / darker: 18 / 32 / 49% más oscuro. dark y darker se usan como
 *   texto sobre los tints: se oscurecen más si hace falta para ≥ 4.5:1.
 * - light: mismo tono, +11% de luminosidad.
 * - soft / soft-2 / tint / tint-2: mezcla con blanco 65 / 78 / 85 / 90%.
 */
export function derivarVariablesAccent(accent: string | null | undefined): VariablesAccent {
  const base = normalizarColorHex(accent) ?? (normalizarColorHex(DEFAULT_ACCENT_COLOR) as string)
  const tint = mezclarBlanco(base, 0.85)
  const tint2 = mezclarBlanco(base, 0.9)
  const legible = (c: string) => contraste(c, tint) >= LIGHT_MIN_CONTRASTE
  const fDark = factorOscurecerHasta(base, 0.32, legible)
  return {
    accent: base,
    hover: oscurecer(base, 0.18),
    dark: oscurecer(base, fDark),
    darker: oscurecer(base, Math.max(0.49, Math.min(1, fDark + 0.17))),
    light: enLuminosidad(base, luminosidadHsl(base) + 0.11),
    soft: mezclarBlanco(base, 0.65),
    soft2: mezclarBlanco(base, 0.78),
    tint,
    tint2,
    // Texto y relleno con texto blanco: ≥ 4.5:1 contra blanco (se oscurece si hace falta).
    accent2: oscurecerHasta(enLuminosidad(base, 0.41, ACCENT2_SATURACION), (c) => contraste(c, '#ffffff') >= LIGHT_MIN_CONTRASTE),
  }
}

/**
 * Paleta de ACENTO del tema OSCURO (equivalente a los overrides dark de index.css):
 * - accent: aclarado hasta leerse sobre fondos oscuros; hover y light aclaran.
 * - dark = accent (como en index.css); darker algo más oscuro pero ≥ 4.5:1 sobre
 *   los tints oscuros (se usan como texto).
 * - tint / tint-2 / soft / soft-2: superficies oscuras con el MISMO tono del acento
 *   (luminosidad HSL 9 / 11 / 14 / 18%, saturación atenuada). A diferencia del
 *   primario no se mezclan con --at-bg: su tinte verdoso volvería oliva los tonos
 *   cálidos (los de index.css son marrones).
 */
export function derivarVariablesAccentOscuro(accent: string | null | undefined): VariablesAccent {
  const base = normalizarColorHex(accent) ?? (normalizarColorHex(DEFAULT_ACCENT_COLOR) as string)
  const a = aclararParaTemaOscuro(base)
  const superficie = (l: number) => enLuminosidad(a, l, 0.65)
  const tint = superficie(0.092)
  const tint2 = superficie(0.11)
  const soft = superficie(0.137)
  const legible = (c: string) => [tint, tint2, soft].every((f) => contraste(c, f) >= DARK_MIN_CONTRASTE)
  return {
    accent: a,
    hover: mezclarBlanco(a, 0.18),
    dark: aclararHasta(a, legible),
    darker: aclararHasta(oscurecer(a, 0.1), legible),
    light: mezclarBlanco(a, 0.26),
    soft,
    soft2: superficie(0.176),
    tint,
    tint2,
    accent2: aclararParaTemaOscuro(enLuminosidad(a, 0.553, ACCENT2_SATURACION)),
  }
}

/** CSS vars de acento que el branding sobreescribe (en orden). */
export const ACCENT_CSS_VARS = [
  '--at-accent', '--at-accent-hover', '--at-accent-dark', '--at-accent-darker', '--at-accent-light',
  '--at-accent-soft', '--at-accent-soft-2', '--at-accent-tint', '--at-accent-tint-2', '--at-accent-2',
] as const

function varsAccent(v: VariablesAccent): Record<(typeof ACCENT_CSS_VARS)[number], string> {
  return {
    '--at-accent': v.accent,
    '--at-accent-hover': v.hover,
    '--at-accent-dark': v.dark,
    '--at-accent-darker': v.darker,
    '--at-accent-light': v.light,
    '--at-accent-soft': v.soft,
    '--at-accent-soft-2': v.soft2,
    '--at-accent-tint': v.tint,
    '--at-accent-tint-2': v.tint2,
    '--at-accent-2': v.accent2,
  }
}

/**
 * Mapa de CSS vars de ACENTO (tema claro) para un color custom, o null si no hay
 * (restablecer). Incluye --at-accent-2; index.css tiñe con él --at-surface-tint
 * sólo mientras no haya color de MARCA custom (con marca, estilosMarca lo fija).
 */
export function estilosAccent(accentColor: string | null | undefined): Record<string, string> | null {
  const color = normalizarColorHex(accentColor)
  return color ? varsAccent(derivarVariablesAccent(color)) : null
}

/** Igual que `estilosAccent` pero con los valores del tema OSCURO. */
export function estilosAccentOscuro(accentColor: string | null | undefined): Record<string, string> | null {
  const color = normalizarColorHex(accentColor)
  return color ? varsAccent(derivarVariablesAccentOscuro(color)) : null
}

/** id del <style> que BrandingApplier inyecta en <head>. */
export const BRANDING_STYLE_ID = 'at-branding'

function declaraciones(...mapas: (Record<string, string> | null)[]): string {
  return mapas
    .flatMap((m) => (m ? Object.entries(m) : []))
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ')
}

/** Proporciones de los color-mix de index.css sobre --at-primary. */
const BORDE_ORGANICO_MEZCLA = 0.16 // --at-border-organic: color-mix(--at-primary 16%, transparent)
const FILA_BORDE_MEZCLA = 0.12 //     --at-table-row-border: color-mix(--at-primary 12%, transparent)
const FILA_HOVER_MEZCLA = 0.06 //     --at-table-row-hover:  color-mix(--at-primary 6%, transparent)
/** Navegadores SIN color-mix (Safari/iOS < 16.2, Chrome < 111). */
const SIN_COLOR_MIX = '@supports not (color: color-mix(in srgb, red 50%, blue))'
/** Superficie del tema claro (= --at-surface en src/index.css), donde van las filas de tabla. */
const LIGHT_SURFACE = '#FFFFFF'

/**
 * Respaldos SÓLIDOS, para navegadores sin color-mix, de los tokens que index.css
 * deriva de --at-primary con color-mix translúcido. null sin color de marca custom.
 * - --at-border-organic: claro, el primario al 16% sobre --at-bg (la receta del
 *   #D0D2CB de index.css); oscuro, el primario oscuro al 16% sobre la superficie
 *   oscura, que es lo que el color-mix pinta sobre una tarjeta.
 * - --at-table-row-border / --at-table-row-hover: el primario (claro / oscuro) al
 *   12 / 6% sobre --at-surface, el fondo de las filas de DataTable.
 *
 * Van dentro de `@supports not (…)` y NO como doble declaración (hex y luego
 * color-mix): una custom property acepta cualquier valor, así que el navegador
 * viejo se queda con el color-mix y la propiedad que la usa se anula. Los
 * navegadores modernos ignoran el bloque y conservan el color-mix de index.css,
 * que ya sigue a --at-primary.
 */
export function respaldosSinColorMix(
  primaryColor: string | null | undefined,
): { claro: Record<string, string>; oscuro: Record<string, string> } | null {
  const color = normalizarColorHex(primaryColor)
  if (!color) return null
  const pd = derivarVariablesMarcaOscuro(color).primary
  return {
    claro: {
      '--at-border-organic': mezclar(color, LIGHT_BG, BORDE_ORGANICO_MEZCLA),
      '--at-table-row-border': mezclar(color, LIGHT_SURFACE, FILA_BORDE_MEZCLA),
      '--at-table-row-hover': mezclar(color, LIGHT_SURFACE, FILA_HOVER_MEZCLA),
    },
    oscuro: {
      '--at-border-organic': mezclar(pd, DARK_SURFACE, BORDE_ORGANICO_MEZCLA),
      '--at-table-row-border': mezclar(pd, DARK_SURFACE, FILA_BORDE_MEZCLA),
      '--at-table-row-hover': mezclar(pd, DARK_SURFACE, FILA_HOVER_MEZCLA),
    },
  }
}

/**
 * Hoja de estilos con los colores de marca para AMBOS temas, o null si no hay
 * ningún color custom (el caller quita la hoja → defaults de src/index.css).
 *
 * Los selectores replican los de src/index.css (auto por prefers-color-scheme
 * salvo [data-theme="light"], y [data-theme="dark"] manual) con `:root:root`
 * para tener MÁS especificidad que los de la hoja base: ganan sin depender del
 * orden de inserción y, a diferencia de un style inline en <html>, el bloque
 * dark sigue ganando al claro cuando el tema es oscuro. Con color de marca, una
 * última línea añade los respaldos sólidos de los tokens con color-mix (ver
 * respaldosSinColorMix) sólo para navegadores sin color-mix.
 */
export function hojaEstilosMarca(
  primaryColor: string | null | undefined,
  accentColor: string | null | undefined,
): string | null {
  const claro = declaraciones(estilosMarca(primaryColor), estilosAccent(accentColor))
  const oscuro = declaraciones(estilosMarcaOscuro(primaryColor), estilosAccentOscuro(accentColor))
  if (!claro) return null
  const lineas = [
    `:root:root { ${claro} }`,
    `@media (prefers-color-scheme: dark) { :root:root:not([data-theme="light"]) { ${oscuro} } }`,
    `:root:root[data-theme="dark"] { ${oscuro} }`,
  ]
  const respaldos = respaldosSinColorMix(primaryColor)
  if (respaldos) {
    const c = declaraciones(respaldos.claro), o = declaraciones(respaldos.oscuro)
    lineas.push(
      `${SIN_COLOR_MIX} { :root:root { ${c} } ` +
        `@media (prefers-color-scheme: dark) { :root:root:not([data-theme="light"]) { ${o} } } ` +
        `:root:root[data-theme="dark"] { ${o} } }`,
    )
  }
  return lineas.join('\n')
}
