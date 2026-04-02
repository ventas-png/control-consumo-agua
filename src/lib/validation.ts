// Maximum lengths to prevent DoS via oversized inputs
export const INPUT_MAX_LENGTHS = {
  email: 254,       // RFC 5321 limit
  name: 200,
  password: 128,
  phone: 20,
  general: 500,
} as const

export function sanitizeInput(input: string, maxLength = INPUT_MAX_LENGTHS.general): string {
  return input
    .slice(0, maxLength)
    .replace(/[<>"'`]/g, '')         // Remove HTML/template injection chars
    .replace(/javascript:/gi, '')    // Block JS protocol
    .replace(/data:/gi, '')          // Block data: URIs
    .replace(/vbscript:/gi, '')      // Block VBScript protocol
    .replace(/on\w+\s*=/gi, '')      // Block inline event handlers
    .trim()
}

export function sanitizeHTML(html: string): string {
  const temp = document.createElement('div')
  temp.textContent = html
  return temp.innerHTML
}

export function validateEmail(email: string): boolean {
  if (!email || email.length > INPUT_MAX_LENGTHS.email) return false
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email.toLowerCase())
}

export function validatePhoneNumber(phone: string): boolean {
  if (!phone || phone.length > INPUT_MAX_LENGTHS.phone) return false
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

export function validateNumber(
  input: number | string,
  min = 0,
  max = Infinity
): boolean {
  const num = parseFloat(String(input))
  return !isNaN(num) && num >= min && num <= max
}

/**
 * Escapes a value for safe interpolation into an HTML attribute (e.g. value="...").
 * Prevents attribute-injection XSS in template-literal HTML strings.
 */
export function escAttr(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Escapes a value for safe interpolation as HTML text content (between tags).
 * Prevents tag-injection XSS in template-literal HTML strings.
 */
export function escText(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Validates password strength. Returns null if valid, error message otherwise.
 * Minimum 8 chars, at least one letter and one number.
 */
export function validatePasswordStrength(password: string): string | null {
  if (!password || password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.'
  if (password.length > INPUT_MAX_LENGTHS.password) return 'La contraseña es demasiado larga.'
  if (!/[a-zA-Z]/.test(password)) return 'La contraseña debe contener al menos una letra.'
  if (!/[0-9]/.test(password)) return 'La contraseña debe contener al menos un número.'
  return null
}
