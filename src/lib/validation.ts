import DOMPurify from 'dompurify'

// Strip all HTML tags + attributes from `input`. Defends against XSS payloads
// stored at rest that later leak into HTML rendering contexts (chat history,
// emails, server-rendered exports). The previous regex-based blacklist missed
// Unicode-escaped variants (<, &#x3C;) and SVG attributes; DOMPurify
// parses the input as HTML and discards anything not in the allowlist (empty).
export function sanitizeInput(input: string): string {
  if (!input) return ''
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
  }).trim()
}

// HTML-encodes a string so it can be inserted into an HTML context as text
// without being interpreted as markup. Suitable for places that build HTML
// strings by concatenation (rare in this codebase — JSX auto-escapes).
export function sanitizeHTML(html: string): string {
  const temp = document.createElement('div')
  temp.textContent = html
  return temp.innerHTML
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email.toLowerCase())
}

export function validatePhoneNumber(phone: string): boolean {
  const cleaned = phone.trim().replace(/[\s\-\.\(\)]/g, '')
  // E.164 internacional: + seguido de 7 a 15 dígitos
  if (/^\+\d{7,15}$/.test(cleaned)) return true
  // Local: exactamente 8 dígitos
  return /^\d{8}$/.test(cleaned.replace(/\D/g, ''))
}

export function formatPhoneForWa(phone: string, defaultCountryCode = '502'): string {
  const cleaned = phone.trim().replace(/[\s\-\.\(\)]/g, '')
  // E.164: quitar el + para wa.me
  if (/^\+\d{7,15}$/.test(cleaned)) return cleaned.slice(1)
  // Local 8 dígitos: agregar código de país
  const digits = cleaned.replace(/\D/g, '')
  if (digits.length === 8) return defaultCountryCode + digits
  // Cualquier otro caso: devolver solo dígitos
  return digits
}

export function validatePasswordStrength(password: string): { valid: boolean; message: string } {
  if (password.length < 8) return { valid: false, message: 'Debe tener al menos 8 caracteres' }
  if (!/[A-Z]/.test(password)) return { valid: false, message: 'Debe incluir al menos una mayuscula' }
  if (!/[a-z]/.test(password)) return { valid: false, message: 'Debe incluir al menos una minuscula' }
  if (!/\d/.test(password)) return { valid: false, message: 'Debe incluir al menos un numero' }
  return { valid: true, message: '' }
}

// ── Contraseñas filtradas (HaveIBeenPwned) ───────────────────────────────────
//
// Supabase Auth tiene activa la protección contra contraseñas filtradas: rechaza
// con `weak_password` / `reasons: ["pwned"]` cualquier contraseña que aparezca
// en HaveIBeenPwned aunque cumpla `validatePasswordStrength`. La edge function
// ya traduce ese rechazo a un mensaje claro, pero el usuario solo lo veía
// DESPUÉS de enviar. Esta comprobación corre en el navegador antes de llamar al
// backend, con el mismo texto, para que corrija la contraseña en el formulario.
//
// Privacidad (k-anonimato): se calcula el SHA-1 de la contraseña en el
// navegador y a la API solo viaja el PREFIJO de 5 hex. La API devuelve todos los
// sufijos con ese prefijo (~500-800) y la comparación se hace localmente. Ni la
// contraseña ni su hash completo salen del dispositivo.
//
// Fail-open A PROPÓSITO: si la API no responde (sin red, caída, CSP, timeout,
// navegador sin crypto.subtle) la función devuelve `false` y el servidor —que
// hace la misma comprobación— decide. Nunca debe impedir un registro legítimo
// por un fallo de un tercero.

/** Mismo texto que `classifyAuthCreateError` en la edge function create-cliente-account. */
export const PWNED_PASSWORD_MESSAGE =
  'La contraseña es demasiado común o apareció en filtraciones de datos conocidas. Elija una contraseña distinta, que no use en otros sitios.'

/** Endpoint de rango (k-anonimato). Debe estar permitido en `connect-src` de la CSP (vercel.json). */
export const PWNED_PASSWORDS_RANGE_URL = 'https://api.pwnedpasswords.com/range/'

/** Tiempo máximo de espera por la API antes de dejar que decida el servidor. */
export const PWNED_CHECK_TIMEOUT_MS = 5000

export interface PwnedCheckOptions {
  /** Inyectable en tests; por defecto `globalThis.fetch`. */
  fetchImpl?: typeof fetch
  /** Por defecto `PWNED_CHECK_TIMEOUT_MS`. */
  timeoutMs?: number
}

async function sha1Hex(text: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  const digest = new Uint8Array(await subtle.digest('SHA-1', new TextEncoder().encode(text)))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

/**
 * ¿Aparece la contraseña en filtraciones conocidas (HaveIBeenPwned)?
 *
 * Devuelve `true` SOLO cuando la API confirma que la contraseña está filtrada.
 * Devuelve `false` tanto si no aparece como si la comprobación no pudo
 * hacerse (ver fail-open arriba): en ese caso la decisión queda en el servidor.
 */
export async function isPasswordPwned(password: string, opts: PwnedCheckOptions = {}): Promise<boolean> {
  if (!password) return false
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') return false

  let hash: string | null
  try {
    hash = await sha1Hex(password)
  } catch {
    return false
  }
  if (!hash) return false

  const prefix = hash.slice(0, 5)
  const suffix = hash.slice(5)

  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller
    ? setTimeout(() => controller.abort(), opts.timeoutMs ?? PWNED_CHECK_TIMEOUT_MS)
    : null
  try {
    const res = await fetchImpl(`${PWNED_PASSWORDS_RANGE_URL}${prefix}`, {
      method: 'GET',
      signal: controller?.signal,
      // Sin cookies ni credenciales: la petición no identifica al usuario.
      credentials: 'omit',
    })
    if (!res.ok) return false
    const body = await res.text()
    // Formato: una línea por sufijo, `SUFIJO:CONTADOR` (hex en mayúsculas,
    // separadas por CRLF). Un contador de 0 es relleno (padding) y se ignora.
    // No se pide `Add-Padding`: es una cabecera no simple y obligaría a un
    // preflight CORS; la petición GET sin cabeceras extra no lo necesita.
    for (const line of body.split(/\r?\n/)) {
      const sep = line.indexOf(':')
      const lineSuffix = (sep === -1 ? line : line.slice(0, sep)).trim().toUpperCase()
      if (lineSuffix !== suffix) continue
      const count = sep === -1 ? 1 : parseInt(line.slice(sep + 1), 10)
      return Number.isNaN(count) || count > 0
    }
    return false
  } catch {
    // Red caída, timeout (AbortError), CSP, respuesta ilegible: decide el servidor.
    return false
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

export function validateNumber(
  input: number | string,
  min = 0,
  max = Infinity
): boolean {
  const num = parseFloat(String(input))
  return !isNaN(num) && num >= min && num <= max
}
