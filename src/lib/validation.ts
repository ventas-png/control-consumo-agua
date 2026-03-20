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
  const phoneRegex = /^\d{8}$/
  return phoneRegex.test(phone.replace(/\D/g, ''))
}

export function validateNumber(
  input: number | string,
  min = 0,
  max = Infinity
): boolean {
  const num = parseFloat(String(input))
  return !isNaN(num) && num >= min && num <= max
}
