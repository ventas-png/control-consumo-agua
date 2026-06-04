// plat:P18 — Preferencias regionales + formateo local PURO (Intl). Testeable sin
// DOM. La adopción del formateo en la app es incremental; aquí va el contrato.

export type LocalePref = 'es' | 'en'
export type CurrencyPref = 'GTQ' | 'MXN' | 'USD'

export interface PreferenciasRegionales {
  locale: LocalePref
  timezone: string
  currency: CurrencyPref
}

export const PREFERENCIAS_DEFAULT: PreferenciasRegionales = {
  locale: 'es',
  timezone: 'America/Guatemala',
  currency: 'GTQ',
}

/** Zonas horarias ofrecidas en la UI (GT/MX + UTC). */
export const TIMEZONES_DISPONIBLES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'America/Guatemala', label: 'Guatemala (GMT-6)' },
  { value: 'America/Mexico_City', label: 'Ciudad de México (GMT-6)' },
  { value: 'America/Cancun', label: 'Cancún (GMT-5)' },
  { value: 'America/Tijuana', label: 'Tijuana (GMT-8)' },
  { value: 'UTC', label: 'UTC' },
]

export const CURRENCIES_DISPONIBLES: ReadonlyArray<{ value: CurrencyPref; label: string }> = [
  { value: 'GTQ', label: 'Quetzal (GTQ · Q)' },
  { value: 'MXN', label: 'Peso mexicano (MXN · $)' },
  { value: 'USD', label: 'Dólar (USD · $)' },
]

/** Símbolo + código de cada moneda soportada. Puro. */
export function monedaInfo(currency: string): { codigo: string; simbolo: string } {
  switch (currency) {
    case 'GTQ': return { codigo: 'GTQ', simbolo: 'Q' }
    case 'MXN': return { codigo: 'MXN', simbolo: '$' }
    case 'USD': return { codigo: 'USD', simbolo: '$' }
    default: return { codigo: currency, simbolo: '' }
  }
}

/**
 * Mezcla con los defaults y normaliza valores POSIBLEMENTE inválidos (p. ej. una
 * fila de BD con `locale`/`currency` como string libre) → preferencias válidas.
 */
export function normalizarPreferencias(
  p?: { locale?: string | null; timezone?: string | null; currency?: string | null } | null,
): PreferenciasRegionales {
  const locale: LocalePref = p?.locale === 'en' ? 'en' : 'es'
  const currency: CurrencyPref =
    p?.currency === 'MXN' || p?.currency === 'USD' ? p.currency : 'GTQ'
  const timezone =
    typeof p?.timezone === 'string' && p.timezone.trim() !== '' ? p.timezone : PREFERENCIAS_DEFAULT.timezone
  return { locale, timezone, currency }
}

/** Locale BCP-47 efectivo para Intl (es→es-GT/es-MX según moneda; en→en-US). */
export function localeIntl(p: PreferenciasRegionales): string {
  if (p.locale === 'en') return 'en-US'
  return p.currency === 'MXN' ? 'es-MX' : 'es-GT'
}

/** Formatea un ISO timestamp en la zona horaria/idioma del usuario. */
export function formatFechaHora(iso: string | null | undefined, p: PreferenciasRegionales): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  try {
    return new Intl.DateTimeFormat(localeIntl(p), {
      dateStyle: 'medium', timeStyle: 'short', timeZone: p.timezone,
    }).format(d)
  } catch {
    return d.toISOString()
  }
}

/** Formatea un monto en la moneda/idioma del usuario. */
export function formatMoneda(n: number, p: PreferenciasRegionales): string {
  const v = Number.isFinite(n) ? n : 0
  try {
    return new Intl.NumberFormat(localeIntl(p), {
      style: 'currency', currency: p.currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(v)
  } catch {
    const { simbolo } = monedaInfo(p.currency)
    return `${simbolo}${v.toFixed(2)}`
  }
}
