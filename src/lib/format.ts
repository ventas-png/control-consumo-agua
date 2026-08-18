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

// ── Fechas de calendario (columnas SQL `date` / cadenas 'YYYY-MM-DD') ──────
//
// Una columna SQL `date` NO es un instante: es una fecha de calendario. El
// 2026-01-01 de una factura es el 1 de enero en Guatemala, en Tokio y en la
// consola de Supabase. `new Date('2026-01-01')` en cambio lo interpreta como
// medianoche **UTC** (ECMA-262 §21.4.3.2: el formato date-only es UTC), así
// que en cualquier huso negativo —America/Guatemala GMT-6,
// America/Los_Angeles GMT-8— `getDate()` devuelve 31 y la UI muestra el día
// ANTERIOR.
//
// Estas funciones son la ÚNICA forma soportada de leer una fecha de
// calendario en la app. No concatenar 'T12:00:00' en cada componente: ese
// parche estaba disperso en ~30 archivos, no validaba la entrada (un null
// producía la cadena 'nullT12:00:00' → Invalid Date) y no cubría la
// aritmética de días.
//
// Para timestamps REALES (timestamptz: created_at, fecha_envio de
// notificaciones, registros.fecha del módulo de agua) NO usar esto: ahí el
// instante y su conversión a la zona del usuario son justamente el
// comportamiento correcto.

/** 'YYYY-MM-DD', tolerando un sufijo de hora que Postgres nunca manda en `date`. */
const RE_FECHA_CALENDARIO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/

/**
 * Parsea una fecha de calendario 'YYYY-MM-DD' como medianoche LOCAL, de modo
 * que año, mes y día se conservan en cualquier zona horaria.
 *
 * Devuelve `null` —nunca un Invalid Date— para null, undefined, cadena vacía,
 * formato no reconocido o fecha inexistente (2026-02-29, 2026-13-01).
 */
export function parseFechaCalendario(value: string | Date | null | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value !== 'string') return null
  const m = RE_FECHA_CALENDARIO.exec(value.trim())
  if (!m) return null
  const [, ys, ms, ds] = m
  const y = Number(ys)
  const mes = Number(ms)
  const d = Number(ds)
  if (mes < 1 || mes > 12 || d < 1 || d > 31) return null
  const out = new Date(y, mes - 1, d)
  // Años < 100 los mapea el constructor a 19xx; y el round-trip descarta
  // desbordes de calendario (31 de febrero → 3 de marzo).
  out.setFullYear(y)
  if (out.getFullYear() !== y || out.getMonth() !== mes - 1 || out.getDate() !== d) return null
  return out
}

/** `true` si el valor es una cadena de fecha de calendario válida. */
export function esFechaCalendario(value: unknown): value is string {
  return typeof value === 'string' && parseFechaCalendario(value) !== null
}

/**
 * Formatea una fecha de calendario conservando el día. Sustituye a
 * `new Date(col).toLocaleDateString(...)` y a `new Date(col + 'T12:00:00')`.
 *
 * Los valores no parseables devuelven `fallback` (por defecto ''), nunca
 * 'Invalid Date'.
 */
export function formatFechaCalendario(
  value: string | Date | null | undefined,
  opciones: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' },
  locale = defaultLocale,
  fallback = '',
): string {
  const d = parseFechaCalendario(value)
  if (!d) return fallback
  return d.toLocaleDateString(locale, opciones)
}

/** Hoy como fecha de calendario LOCAL (medianoche local). */
export function hoyCalendario(): Date {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

/** Número de día absoluto, inmune a DST (no usa la duración real del día). */
function diaAbsoluto(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000
}

/**
 * Días completos de `desde` a `hasta` (positivo si `hasta` es posterior).
 * `null` si alguno no es una fecha de calendario válida.
 *
 * Acepta también un `Date` (p. ej. `new Date()`) del que toma su día LOCAL.
 */
export function diasEntreFechasCalendario(
  desde: string | Date | null | undefined,
  hasta: string | Date | null | undefined,
): number | null {
  const a = parseFechaCalendario(desde)
  const b = parseFechaCalendario(hasta)
  if (!a || !b) return null
  return diaAbsoluto(b) - diaAbsoluto(a)
}

/**
 * Días que faltan desde hoy hasta la fecha de calendario. Negativo si ya pasó,
 * 0 si es hoy, `null` si el valor es inválido. Reemplaza el patrón
 * `Math.ceil((new Date(col).getTime() - Date.now()) / 86400000)`, que en husos
 * negativos se equivocaba en un día.
 */
export function diasHastaFechaCalendario(
  value: string | Date | null | undefined,
  referencia: Date = new Date(),
): number | null {
  return diasEntreFechasCalendario(referencia, value)
}

/** `true` si la fecha de calendario es ESTRICTAMENTE anterior a hoy. */
export function esFechaCalendarioVencida(
  value: string | Date | null | undefined,
  referencia: Date = new Date(),
): boolean {
  const dias = diasHastaFechaCalendario(value, referencia)
  return dias !== null && dias < 0
}

/**
 * Suma días a una fecha de calendario y devuelve 'YYYY-MM-DD' (`null` si la
 * entrada es inválida). Puro sobre el calendario: sin round-trip por UTC, así
 * que no se desplaza en husos negativos ni en cambios de horario.
 */
export function sumarDiasCalendario(
  value: string | Date | null | undefined,
  dias: number,
): string | null {
  const d = parseFechaCalendario(value)
  if (!d || !Number.isFinite(dias)) return null
  d.setDate(d.getDate() + Math.trunc(dias))
  return dateLocalISO(d)
}

// ── Dates ──────────────────────────────────────────────────────────────────

/**
 * Parsea una fecha que puede venir como 'YYYY-MM-DD' o ISO completo.
 * Las fechas de calendario van por `parseFechaCalendario` (medianoche local);
 * los ISO con hora conservan su semántica de instante.
 */
export function parseFecha(value: string | Date | null | undefined): Date {
  if (!value) return new Date(NaN)
  if (value instanceof Date) return value
  if (!value.includes('T')) return parseFechaCalendario(value) ?? new Date(NaN)
  return new Date(value)
}

/**
 * Fecha LOCAL como 'YYYY-MM-DD' (E4/D5). El patrón previo
 * `new Date().toISOString().split('T')[0]` devuelve la fecha UTC: en GMT-6,
 * después de las 18:00 locales ya es "mañana" — una captura nocturna quedaba
 * pre-llenada con la fecha del día siguiente y la lectura caía al ciclo de
 * facturación equivocado. Usar SIEMPRE este helper para defaults de inputs
 * de fecha y payloads date-only.
 */
export function dateLocalISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Hoy LOCAL como 'YYYY-MM-DD' (ver dateLocalISO). */
export function hoyLocalISO(): string {
  return dateLocalISO(new Date())
}

/**
 * Período LOCAL como 'YYYY-MM' (auditoría 2026-07-28, Bloque D · PR-24).
 *
 * Mismo defecto que `dateLocalISO` pero con consecuencia mayor: el patrón
 * `new Date().toISOString().slice(0, 7)` toma el mes UTC, así que en GMT-6 la
 * noche del ÚLTIMO día del mes ya reporta el mes siguiente. Un cierre contable
 * o una emisión de cuotas lanzada a las 19:00 del día 31 se etiquetaba con el
 * período equivocado.
 */
export function mesLocalISO(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Fecha-hora LOCAL como 'YYYY-MM-DDTHH:mm', el formato que espera
 * `<input type="datetime-local">`. El patrón `toISOString().slice(0, 16)`
 * prellenaba el control con la hora UTC: en GMT-6, seis horas en el futuro.
 */
export function datetimeLocalISO(d: Date = new Date()): string {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${dateLocalISO(d)}T${hh}:${mm}`
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
