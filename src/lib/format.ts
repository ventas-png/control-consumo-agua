// Format helpers — single source of truth for dates, currency, and numbers.
//
// Background: la app tenía 303 usos de toLocaleDateString/toLocaleString con
// 5 locales distintos ('es', 'es-GT', 'es-MX', 'es-CR', 'es-ES') mezclados
// inconsistentemente. Y formatos de moneda hardcodeados con "Q " que rompían
// para empresas con otra moneda (bug visto en AdminHistoryTab #71).
//
// Estas utilidades centralizan el formato. La locale default es 'es-GT'
// (Guatemala — empresa piloto) pero puede sobrescribirse por llamada o
// configurar globalmente via setDefaultLocale().

let defaultLocale = 'es-GT'

export function setDefaultLocale(locale: string): void {
  defaultLocale = locale
}

export function getDefaultLocale(): string {
  return defaultLocale
}

// ── Dates ──────────────────────────────────────────────────────────────────

/**
 * Parsea una fecha que puede venir como 'YYYY-MM-DD' o ISO completo.
 * Para 'YYYY-MM-DD' agrega T12:00:00 para evitar shift de zona horaria
 * (las fechas puras de BD se trataban como UTC midnight y aparecían un
 * día antes en husos negativos).
 */
export function parseFecha(value: string | Date | null | undefined): Date {
  if (!value) return new Date(NaN)
  if (value instanceof Date) return value
  return new Date(value.includes('T') ? value : value + 'T12:00:00')
}

/** Fecha sin hora — '15 de mayo de 2026' o similar según locale. */
export function formatDate(
  value: string | Date | null | undefined,
  locale = defaultLocale,
): string {
  const d = parseFecha(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })
}

/** Fecha corta — '15/05/2026'. */
export function formatDateShort(
  value: string | Date | null | undefined,
  locale = defaultLocale,
): string {
  const d = parseFecha(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(locale)
}

/** Fecha + hora — '15/05/2026 14:32'. */
export function formatDateTime(
  value: string | Date | null | undefined,
  locale = defaultLocale,
): string {
  const d = parseFecha(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Currency ───────────────────────────────────────────────────────────────

/**
 * Formato de moneda — siempre con el símbolo de la empresa/proyecto
 * (default 'Q' para Quetzal guatemalteco) seguido del número con 2
 * decimales y separadores de miles según locale.
 *
 * Importante: SIEMPRE pasar el símbolo explícito desde
 * proyecto.moneda_condominios ?? proyecto.moneda ?? 'Q' — no asumir Q.
 */
export function formatCurrency(
  value: number | null | undefined,
  moneda = 'Q',
  locale = defaultLocale,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return `${moneda} 0.00`
  return `${moneda} ${value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ── Numbers ────────────────────────────────────────────────────────────────

/** Número con N decimales y separadores de miles según locale. */
export function formatNumber(
  value: number | null | undefined,
  decimals = 2,
  locale = defaultLocale,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '0'
  return value.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Porcentaje formateado — `formatPercent(0.873)` → '87%'. */
export function formatPercent(
  value: number | null | undefined,
  decimals = 0,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '0%'
  return `${(value * 100).toFixed(decimals)}%`
}

/** Tamaño en bytes legible — '1.2 MB'. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
