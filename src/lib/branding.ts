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
  /** --at-nav-bg: fondo del rail de navegación, OSCURO en ambos temas (lleva texto
   *  --at-nav-ink claro y overlays blancos translúcidos). */
  navBg: string
  /** --at-nav-ink: texto sobre --at-nav-bg (Sidebar, encabezados de SuperAdmin). */
  navInk: string
  /** --at-nav-ink-2: texto de un ítem del rail bajo el puntero y nombre del usuario. */
  navInk2: string
  /** --at-nav-ink-3: texto de los ítems inactivos, icono bajo el puntero, «Salir». */
  navInk3: string
  /** --at-nav-ink-4: iconos inactivos, encabezados de grupo y subtítulos del rail. */
  navInk4: string
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
/** Texto del rail de navegación por defecto (= --at-nav-ink en index.css, fijo en ambos temas). */
export const NAV_INK = '#ECEFE8'

/**
 * --at-nav-ink (index.css: #ECEFE8) desde la marca: un blanco roto teñido del TONO de
 * la marca, con la luminosidad del por defecto (HSL 92.4%) y su saturación (0.18)
 * escalada por la de la marca, acotada a 0.3 para que siga siendo casi blanco. Marcas
 * grises → blanco roto neutro.
 */
export function navInkDesdeMarca(hex: string): string {
  const [h, s] = rgbAHsl(parseRgb(hex))
  const sat = s < SAT_GRIS ? 0 : Math.min((0.18 * s) / MARCA_SAT, 0.3)
  return hslAHex([h, sat, 0.924])
}

/** --at-nav-bg por defecto (index.css). */
export const NAV_BG = '#102622'

/**
 * Grises del rail por defecto (index.css: --at-nav-ink-2 / -3 / -4), del más claro al
 * más apagado: texto bajo el puntero, texto de los ítems inactivos y sus iconos /
 * encabezados de grupo. Son grises verdosos (HSL ~145°, saturación 0.10–0.17).
 */
export const NAV_GRISES = { ink2: '#DCE6E0', ink3: '#B4C5BB', ink4: '#8FA398' } as const

/**
 * Grises del rail (--at-nav-ink-2 / -3 / -4) desde la marca. Cada uno toma
 * el TONO de la marca, conserva la luminosidad HSL del por defecto y escala su
 * saturación por la de la marca, acotada a 0.3 para que sigan siendo grises (marcas
 * grises → grises neutros). Se aclaran si hace falta para leerse sobre el fondo del
 * rail de la misma marca como el por defecto sobre #102622 (≈ 12.4 / 8.8 / 5.9:1),
 * escalado por lo que se lee --at-nav-ink de esa marca respecto del por defecto (así
 * ninguno supera a --at-nav-ink y se conserva la jerarquía) y nunca por debajo de
 * 4.5:1 (también son texto).
 */
export function navGrisesDesdeMarca(hex: string): { ink2: string; ink3: string; ink4: string } {
  const [h, s] = rgbAHsl(parseRgb(hex))
  const fondo = navBgDesdeMarca(hex)
  const escala = Math.min(1, contraste(navInkDesdeMarca(hex), fondo) / contraste(NAV_INK, NAV_BG))
  const gris = (def: string) => {
    const [, sDef, lDef] = rgbAHsl(parseRgb(def))
    const sat = s < SAT_GRIS ? 0 : Math.min((sDef * s) / MARCA_SAT, 0.3)
    const minimo = Math.max(AA, contraste(def, NAV_BG) * escala)
    return aclararHasta(hslAHex([h, sat, lDef]), (c) => contraste(c, fondo) >= minimo)
  }
  return { ink2: gris(NAV_GRISES.ink2), ink3: gris(NAV_GRISES.ink3), ink4: gris(NAV_GRISES.ink4) }
}

function grisesNav(hex: string): Pick<VariablesMarca, 'navInk2' | 'navInk3' | 'navInk4'> {
  const g = navGrisesDesdeMarca(hex)
  return { navInk2: g.ink2, navInk3: g.ink3, navInk4: g.ink4 }
}

/**
 * Ítem activo del rail: el punto (--at-nav-accent), su halo (--at-nav-accent-glow) y el
 * fondo del icono (--at-nav-accent-soft), o null sin colores custom (index.css:
 * var(--at-accent) y el terracota al 70 / 30%). Toma el acento custom si lo hay y, si
 * no, el primario de la marca. Se aclara si hace falta para destacar sobre el fondo
 * del rail (el derivado de la marca, o el por defecto) al menos tanto como el punto
 * terracota por defecto sobre #102622 (≈ 3.7:1; nunca menos de 3:1, el mínimo WCAG
 * para componentes de UI). Halo y fondo son el mismo color al 70 / 30%. Igual en
 * ambos temas.
 */
export function navAccentDesdeMarca(
  primaryColor: string | null | undefined,
  accentColor: string | null | undefined,
): { color: string; glow: string; soft: string } | null {
  const primario = normalizarColorHex(primaryColor), acento = normalizarColorHex(accentColor)
  const fuente = acento ?? primario
  if (!fuente) return null
  const fondo = primario ? navBgDesdeMarca(primario) : NAV_BG
  const minimo = Math.max(3, contraste(DEFAULT_ACCENT_COLOR, NAV_BG))
  const color = aclararHasta(fuente, (c) => contraste(c, fondo) >= minimo)
  const [r, g, b] = parseRgb(color)
  return { color, glow: `rgba(${r}, ${g}, ${b}, 0.7)`, soft: `rgba(${r}, ${g}, ${b}, 0.3)` }
}

/** Variaciones del MRR en el hero de SuperAdmin por defecto (index.css): verde / rojo claros. */
export const NAV_DELTA = { positivo: '#B7F4C9', negativo: '#F4B7B7' } as const
/** Saturación del segundo tono de la marca respecto de la suya (#577B69 frente a #1B3B36). */
const SEGUNDO_TONO_SAT = 0.46
/** Fondo de las pills del hero: blanco al 10% sobre el rail. */
const PILL_BLANCO = 0.1

/**
 * Cabeceras de SuperAdmin (sobre --at-nav-bg, oscuro fijo), o null sin colores custom
 * (index.css: #1B3B36, #577B69 —el primario / accent-2 del tema claro— y los NAV_DELTA).
 * Iguales en ambos temas, como el rail:
 * - --at-nav-primary: la pestaña activa (texto blanco). El primario de la marca,
 *   oscurecido si hace falta para que el blanco se lea ≥ 4.5:1.
 * - --at-nav-primary-2: segundo color del degradado de la pestaña y del hero. El
 *   --at-accent-2 del acento custom si lo hay; si no, un segundo tono de la marca (su
 *   tono, saturación × 0.46 —≤ 0.35— y luminosidad HSL 41%, como #577B69 respecto de
 *   #1B3B36), también con el blanco ≥ 4.5:1. Así una marca sin acento no acaba en verde.
 * - --at-nav-positive / --at-nav-negative: «↑ / ↓ vs hace 30 días». Conservan su verde
 *   / rojo (tienen significado) y escalan la saturación por la de la marca como los
 *   estados; se aclaran si hace falta para leerse sobre su pill como los por defecto,
 *   en proporción a lo que se lee --at-nav-ink (nunca < 4.5:1).
 */
export function navCabeceraDesdeMarca(
  primaryColor: string | null | undefined,
  accentColor: string | null | undefined,
): Record<string, string> | null {
  const primario = normalizarColorHex(primaryColor), acento = normalizarColorHex(accentColor)
  if (!primario && !acento) return null
  const marca = primario ?? (normalizarColorHex(DEFAULT_BRAND_COLOR) as string)
  const s = rgbAHsl(parseRgb(marca))[1]
  const segundo = segundoTono(marca, acento)

  const fondo = primario ? navBgDesdeMarca(primario) : NAV_BG
  const pill = mezclar('#ffffff', fondo, PILL_BLANCO)
  const escala = Math.min(1, contraste(primario ? navInkDesdeMarca(primario) : NAV_INK, fondo) / contraste(NAV_INK, NAV_BG))
  const k = Math.min(s / MARCA_SAT, 1)
  const delta = (def: string) => {
    const minimo = Math.max(AA, contraste(def, mezclar('#ffffff', NAV_BG, PILL_BLANCO)) * escala)
    return aclararHasta(transformar(def, 0, k, 0), (c) => contraste(c, pill) >= minimo)
  }
  return {
    '--at-nav-primary': blancoLegible(marca),
    '--at-nav-primary-2': segundo,
    '--at-nav-positive': delta(NAV_DELTA.positivo),
    '--at-nav-negative': delta(NAV_DELTA.negativo),
  }
}

/** Oscurece lo mínimo para que el texto blanco se lea ≥ 4.5:1 encima (nada si ya se lee). */
function blancoLegible(hex: string): string {
  return oscurecerHasta(hex, (x) => contraste('#ffffff', x) >= AA)
}

/**
 * Segundo color de los degradados de marca (tema claro), con texto blanco ≥ 4.5:1: el
 * --at-accent-2 del acento custom si lo hay; si no, un segundo tono de la propia marca
 * (su tono, saturación × 0.46 —≤ 0.35— y luminosidad HSL 41%, como #577B69 respecto de
 * #1B3B36). Así una marca sin acento no acaba en el verde por defecto.
 */
function segundoTono(marca: string, acento: string | null): string {
  if (acento) return derivarVariablesAccent(acento).accent2
  const [h, s] = rgbAHsl(parseRgb(marca))
  return blancoLegible(hslAHex([h, s < SAT_GRIS ? 0 : Math.min(s * SEGUNDO_TONO_SAT, ACCENT2_SATURACION), 0.41]))
}

/** Botones principales por defecto en dark (index.css): #5E9D8A / #79A18E oscurecidos hasta blanco ≥ 4.5:1. */
export const CTA_OSCURO = { cta: '#4D8071', cta2: '#5E7D6F' } as const

/**
 * Botones principales con texto blanco (degradado --at-cta → --at-cta-2), o null sin
 * colores custom (index.css: var(--at-primary) / var(--at-accent-2) en claro y
 * CTA_OSCURO en dark). Mismo color de partida que las cabeceras de SuperAdmin:
 * - claro: el primario y el segundo tono (segundoTono), oscurecidos si hace falta para
 *   que el blanco se lea ≥ 4.5:1 (con una marca amarilla quedaba a 1.4:1);
 * - oscuro: los mismos colores aclarados para el tema oscuro y luego oscurecidos lo
 *   justo para que el blanco se lea ≥ 4.5:1: el tono más claro posible, que destaca
 *   sobre las superficies oscuras (con var(--at-primary) el blanco quedaba a ~3.1:1).
 */
export function ctaDesdeMarca(
  primaryColor: string | null | undefined,
  accentColor: string | null | undefined,
): { claro: Record<string, string>; oscuro: Record<string, string> } | null {
  const primario = normalizarColorHex(primaryColor), acento = normalizarColorHex(accentColor)
  if (!primario && !acento) return null
  const marca = primario ?? (normalizarColorHex(DEFAULT_BRAND_COLOR) as string)
  const segundoOscuro = acento ? derivarVariablesAccentOscuro(acento).accent2 : aclararParaTemaOscuro(segundoTono(marca, null))
  return {
    claro: { '--at-cta': blancoLegible(marca), '--at-cta-2': segundoTono(marca, acento) },
    oscuro: {
      '--at-cta': blancoLegible(aclararParaTemaOscuro(marca)),
      '--at-cta-2': blancoLegible(segundoOscuro),
    },
  }
}

/**
 * --at-nav-bg (index.css: #102622, fijo en ambos temas) desde la marca: su tono, su
 * saturación × 1.1 (acotada a 0.85) y luminosidad HSL 10.6%, como el #102622 respecto
 * de #1B3B36. Marcas grises → casi negro neutro. Se oscurece si hace falta para que
 * --at-nav-ink (el derivado de la misma marca) se lea ≥ 7:1 (AAA).
 */
export function navBgDesdeMarca(hex: string): string {
  const [h, s] = rgbAHsl(parseRgb(hex))
  const ink = navInkDesdeMarca(hex)
  const base = hslAHex([h, Math.min(s * 1.1, 0.85), 0.106])
  return oscurecer(base, factorOscurecerHasta(base, 0, (c) => contraste(ink, c) >= 7))
}

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
    navBg: navBgDesdeMarca(base),
    navInk: navInkDesdeMarca(base),
    ...grisesNav(base),
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
    // El rail es oscuro en ambos temas: mismos valores que en claro.
    navBg: navBgDesdeMarca(base),
    navInk: navInkDesdeMarca(base),
    ...grisesNav(base),
  }
}

/** CSS vars de tema que el branding sobreescribe (en orden). */
const TONOS_MARCA_VARS = [
  '--at-primary', '--at-primary-hover', '--at-primary-soft', '--at-primary-2',
  '--at-primary-tint', '--at-primary-soft-2', '--at-primary-mint', '--at-primary-mint-2', '--at-chip',
  '--at-surface-tint', '--at-nav-bg', '--at-nav-ink', '--at-nav-ink-2', '--at-nav-ink-3',
  '--at-nav-ink-4',
] as const

/** Tokens de estado que también siguen a la marca (ver derivarEstados). */
export const ESTADO_CSS_VARS = [
  '--at-success', '--at-success-tint', '--at-success-border', '--at-success-strong',
  '--at-warning', '--at-warning-tint', '--at-warning-border', '--at-warning-strong',
  '--at-danger', '--at-danger-tint', '--at-danger-border', '--at-danger-strong',
  '--at-info', '--at-info-tint', '--at-info-border', '--at-info-strong',
] as const

/** Tokens de datos que siguen a la marca: el color de las variaciones positivas / negativas (KPIs). */
export const DATOS_CSS_VARS = ['--at-data-positive', '--at-data-negative'] as const

/** CSS vars de tema que el branding sobreescribe (en orden): tonos de marca + estados + datos. */
export const BRAND_CSS_VARS = [...TONOS_MARCA_VARS, ...ESTADO_CSS_VARS, ...DATOS_CSS_VARS] as const

// ─── Estados success / warning / danger / info ──────────────────────────────
// success, warning y danger tienen significado propio (~1600 / ~1400 / ~1800 usos:
// pagado, pendiente, vencido…), así que conservan su TONO por defecto (verde,
// ámbar, rojo) y sólo ajustan a la marca la saturación y la luminosidad de partida:
// una marca viva da estados vivos, una apagada estados apagados. Con el color por
// defecto reproducen los de index.css. info, en cambio, toma el tono de la marca
// (avisos neutros en color de marca), salvo que choque con alguno de los otros.
// Mismos mínimos de contraste que src/test/__tests__/contrast.test.ts: strong sobre
// tint ≥ 4.5, blanco sobre strong ≥ 4.5 y blanco sobre la base ≥ 3 (AA-large); en
// dark, la base y strong ≥ 4.5 sobre la superficie y su tint.

interface PaletaEstado { base: string; tint: string; border: string; strong: string }
type Estado = 'success' | 'warning' | 'danger' | 'info'

/**
 * Paletas de estado por defecto: los valores de src/index.css (claro en :root, dark
 * en los bloques dark). Un test comprueba que sigan iguales a los de index.css.
 */
export const PALETAS_ESTADO_DEFECTO: Record<Estado, { claro: PaletaEstado; oscuro: PaletaEstado }> = {
  success: {
    claro: { base: '#16a34a', tint: '#dcfce7', border: '#bbf7d0', strong: '#15803d' },
    oscuro: { base: '#4ade80', tint: '#14271c', border: '#1f3a2a', strong: '#86efac' },
  },
  warning: {
    claro: { base: '#d97706', tint: '#fef3c7', border: '#fde68a', strong: '#92400e' },
    oscuro: { base: '#fbbf24', tint: '#2a2008', border: '#3a2e0f', strong: '#fcd34d' },
  },
  danger: {
    claro: { base: '#ef4444', tint: '#fef2f2', border: '#fecaca', strong: '#dc2626' },
    oscuro: { base: '#f87171', tint: '#2a1414', border: '#3a1f1f', strong: '#fca5a5' },
  },
  info: {
    claro: { base: '#2563eb', tint: '#dbeafe', border: '#bfdbfe', strong: '#1d4ed8' },
    oscuro: { base: '#60a5fa', tint: '#0f1f33', border: '#1e3a5f', strong: '#93c5fd' },
  },
}
/**
 * --at-data-negative por defecto (index.css: claro / dark): el rojo de las variaciones
 * negativas de los KPIs (StatTile). Es texto sobre las tarjetas.
 */
export const DATA_NEGATIVE_DEFECTO = { claro: '#B23A3A', oscuro: '#E8736B' } as const
/** HSL de la marca por defecto (#1B3B36): referencia para escalar saturación / luminosidad. */
const MARCA_SAT = 0.37
const MARCA_LUM = 0.17
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

/**
 * Transforma un color de una paleta por defecto: tono girado `giro` (0–1), saturación
 * × `k` (acotada entre la mitad de la original y máx(original, 0.85)) y luminosidad
 * + `dl`. paletaEstado sólo mueve la luminosidad de base y strong, y a tint / border
 * (superficies) sólo les baja la saturación (k ≤ 1): una marca viva aviva el texto y
 * los rellenos, no los fondos.
 */
function transformar(hex: string, giro: number, k: number, dl: number): string {
  const [h, s, l] = rgbAHsl(parseRgb(hex))
  return hslAHex([(h + giro + 1) % 1, acotar(s * k, s * 0.5, Math.max(s, 0.85)), acotar(l + dl, 0, 1)])
}

/**
 * Paleta de un estado ajustada a la marca, a partir de la de index.css. Después se
 * imponen los mínimos de contraste de contrast.test.ts, cada uno nunca más exigente
 * que lo que ya cumple la paleta por defecto (así, con la marca por defecto, la
 * paleta sale idéntica a index.css). Claro: blanco sobre base ≥ 3; strong sobre tint
 * ≥ 4.5; blanco sobre strong ≥ 4.5. Dark: base ≥ 4.5 sobre la superficie y su tint;
 * strong ≥ 4.5 sobre su tint.
 */
function paletaEstado(def: { claro: PaletaEstado; oscuro: PaletaEstado }, giro: number, k: number, dl: number): { claro: PaletaEstado; oscuro: PaletaEstado } {
  const blanco = '#ffffff'
  const min = (regla: number, a: string, b: string) => Math.min(regla, contraste(a, b))
  const c = def.claro, o = def.oscuro
  // lum = true: base / strong (texto, rellenos). false: tint / border (superficies).
  const t = (hex: string, lum = false) => transformar(hex, giro, lum ? k : Math.min(k, 1), lum ? dl : 0)

  const tint = t(c.tint)
  const base = oscurecerHslHasta(t(c.base, true), (x) => contraste(blanco, x) >= min(AA_GRANDE, blanco, c.base))
  const strong = oscurecerHslHasta(t(c.strong, true), (x) =>
    contraste(x, tint) >= min(AA, c.strong, c.tint) && contraste(blanco, x) >= min(AA, blanco, c.strong))

  const tintO = t(o.tint)
  const baseO = aclararHasta(t(o.base, true), (x) =>
    contraste(x, DARK_SURFACE) >= min(AA, o.base, DARK_SURFACE) && contraste(x, tintO) >= min(AA, o.base, o.tint))
  const strongO = aclararHasta(t(o.strong, true), (x) => contraste(x, tintO) >= min(AA, o.strong, o.tint))
  return {
    claro: { base, tint, border: t(c.border), strong },
    oscuro: { base: baseO, tint: tintO, border: t(o.border), strong: strongO },
  }
}

/**
 * success / warning / danger / info derivados del color de marca, para claro y
 * oscuro (claves de ESTADO_CSS_VARS), a partir de las paletas de index.css:
 * - saturación × (saturación de la marca / la de la marca por defecto): una marca
 *   viva da estados vivos, una apagada (o gris) estados apagados;
 * - luminosidad de base y strong + 30% de lo que se aparta la de la marca (acotado
 *   a −0.06 / +0.09);
 * - tono: success / warning / danger conservan el suyo. info se gira al tono de la
 *   marca, salvo que la marca sea gris o negra (sin tono: HSL daría 0° = rojo) o que
 *   su tono choque con danger / warning / success (TONOS_ESTADO): entonces queda azul.
 * Con la marca por defecto las cuatro paletas salen idénticas a index.css.
 * Incluye también los tokens de datos de los KPIs (DATOS_CSS_VARS, texto sobre las
 * tarjetas):
 * - --at-data-negative conserva su rojo como danger, con la misma saturación /
 *   luminosidad ajustadas, y se lee ≥ 4.5:1 (o lo que ya da el valor por defecto).
 * - --at-data-positive es el primario de la marca, como en index.css
 *   (var(--at-primary)), salvo que su tono esté a menos de 30° del rojo (se
 *   confundiría con la variación negativa) o que no se lea como texto (< 4.5:1): en
 *   ese tema pasa al verde de success de la marca (strong en claro, base en dark).
 */
export function derivarEstados(primary: string | null | undefined): { claro: Record<string, string>; oscuro: Record<string, string> } {
  const marca = normalizarColorHex(primary) ?? (normalizarColorHex(DEFAULT_BRAND_COLOR) as string)
  const [h, s, l] = rgbAHsl(parseRgb(marca))
  const k = s / MARCA_SAT
  const dl = acotar((l - MARCA_LUM) * 0.3, -0.06, 0.09)
  const choca = s < SAT_GRIS || TONOS_ESTADO.some((t) => distanciaTono(h * 360, t) < ESTADO_DISTANCIA_MIN)
  const tonoInfo = rgbAHsl(parseRgb(PALETAS_ESTADO_DEFECTO.info.claro.base))[0]
  const vars = {} as { claro: Record<string, string>; oscuro: Record<string, string> }
  vars.claro = {}; vars.oscuro = {}
  for (const e of ['success', 'warning', 'danger', 'info'] as const) {
    const giro = e === 'info' && !choca ? h - tonoInfo : 0
    const p = paletaEstado(PALETAS_ESTADO_DEFECTO[e], giro, k, dl)
    for (const tema of ['claro', 'oscuro'] as const) {
      Object.assign(vars[tema], {
        [`--at-${e}`]: p[tema].base, [`--at-${e}-tint`]: p[tema].tint,
        [`--at-${e}-border`]: p[tema].border, [`--at-${e}-strong`]: p[tema].strong,
      })
    }
  }
  // --at-data-positive: el primario, salvo choque con el rojo o ilegible → verde de success.
  const fondoTexto = { claro: '#ffffff', oscuro: DARK_SURFACE } as const
  const primario = { claro: marca, oscuro: derivarVariablesMarcaOscuro(marca).primary }
  const chocaConRojo = s >= SAT_GRIS && distanciaTono(h * 360, 0) < ESTADO_DISTANCIA_MIN
  for (const tema of ['claro', 'oscuro'] as const) {
    const legible = contraste(primario[tema], fondoTexto[tema]) >= AA
    vars[tema]['--at-data-positive'] = !chocaConRojo && legible
      ? primario[tema]
      : vars[tema][tema === 'claro' ? '--at-success-strong' : '--at-success']
  }

  // --at-data-negative: rojo como danger; texto sobre las tarjetas (blanco / superficie dark).
  const dn = DATA_NEGATIVE_DEFECTO
  vars.claro['--at-data-negative'] = oscurecerHslHasta(transformar(dn.claro, 0, k, dl), (x) =>
    contraste(x, '#ffffff') >= Math.min(AA, contraste(dn.claro, '#ffffff')))
  vars.oscuro['--at-data-negative'] = aclararHasta(transformar(dn.oscuro, 0, k, dl), (x) =>
    contraste(x, DARK_SURFACE) >= Math.min(AA, contraste(dn.oscuro, DARK_SURFACE)))
  return vars
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
    '--at-nav-bg': v.navBg,
    '--at-nav-ink': v.navInk,
    '--at-nav-ink-2': v.navInk2,
    '--at-nav-ink-3': v.navInk3,
    '--at-nav-ink-4': v.navInk4,
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
  // Marcador del rail: depende de ambos colores; el rail es igual en ambos temas.
  const marcador = navAccentDesdeMarca(primaryColor, accentColor)
  const nav = marcador
    ? { '--at-nav-accent': marcador.color, '--at-nav-accent-glow': marcador.glow, '--at-nav-accent-soft': marcador.soft }
    : null
  // Cabeceras de SuperAdmin: también dependen de ambos y son iguales en ambos temas.
  const cabecera = navCabeceraDesdeMarca(primaryColor, accentColor)
  // Botones principales: también dependen de ambos, pero sí cambian con el tema.
  const cta = ctaDesdeMarca(primaryColor, accentColor)
  const claro = declaraciones(estilosMarca(primaryColor), estilosAccent(accentColor), nav, cabecera, cta?.claro ?? null)
  const oscuro = declaraciones(estilosMarcaOscuro(primaryColor), estilosAccentOscuro(accentColor), nav, cabecera, cta?.oscuro ?? null)
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
