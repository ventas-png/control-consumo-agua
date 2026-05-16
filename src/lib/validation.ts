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

export function validateNumber(
  input: number | string,
  min = 0,
  max = Infinity
): boolean {
  const num = parseFloat(String(input))
  return !isNaN(num) && num >= min && num <= max
}
