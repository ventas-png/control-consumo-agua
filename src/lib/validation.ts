export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .trim()
}

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

export function validateNumber(
  input: number | string,
  min = 0,
  max = Infinity
): boolean {
  const num = parseFloat(String(input))
  return !isNaN(num) && num >= min && num <= max
}
