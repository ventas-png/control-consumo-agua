// chartColors (C2/V1) — Resuelve tokens CSS `var(--at-*)` a su valor computado
// para Chart.js. El canvas NO entiende variables CSS: pasarle 'var(--at-primary)'
// como color hace que Chart.js caiga a su color por defecto (negro/gris), así
// que las gráficas de tenant nunca mostraban la marca. Mismo enfoque que
// Sparkline (getComputedStyle del token en :root), centralizado y con alfa.

/** Resuelve `var(--at-x)` al valor computado en :root; deja pasar cualquier otro
 *  color literal (hex/rgb/rgba). Fuera del navegador devuelve el token tal cual. */
export function resolveChartColor(color: string): string {
  const m = /^var\((--[A-Za-z0-9-]+)\)$/.exec(color.trim())
  if (!m) return color
  if (typeof window === 'undefined' || typeof document === 'undefined') return color
  const v = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim()
  return v || color
}

/** Resuelve una lista de colores (para arrays de segmentos, p. ej. doughnut). */
export function resolveChartColors(colors: string[]): string[] {
  return colors.map(resolveChartColor)
}

/**
 * Devuelve el color con opacidad `alpha` (para rellenos). Resuelve el token
 * primero y soporta hex (#rgb/#rrggbb), rgb() y rgba(); si no puede parsear,
 * devuelve el color resuelto sin tocar (mejor que romper el render).
 */
export function chartFill(color: string, alpha: number): string {
  const c = resolveChartColor(color)
  const rgb = toRgb(c)
  if (!rgb) return c
  const a = Math.max(0, Math.min(1, alpha))
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`
}

/** Parsea hex/rgb(a) a [r,g,b]; null si no reconoce el formato. */
function toRgb(c: string): [number, number, number] | null {
  const s = c.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h.split('').map((x) => x + x).join('')
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  const rgb = /^rgba?\(\s*([0-9]+)[,\s]+([0-9]+)[,\s]+([0-9]+)/i.exec(s)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return null
}
