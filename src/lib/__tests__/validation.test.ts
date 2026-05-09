import { describe, it, expect } from 'vitest'
import {
  sanitizeInput,
  sanitizeHTML,
  validateEmail,
  validatePhoneNumber,
  formatPhoneForWa,
  validatePasswordStrength,
  validateNumber,
} from '../validation'

describe('sanitizeInput', () => {
  it('elimina etiquetas HTML', () => {
    expect(sanitizeInput('<script>alert(1)</script>')).not.toContain('<')
    expect(sanitizeInput('<script>alert(1)</script>')).not.toContain('>')
  })

  it('elimina javascript: protocol', () => {
    expect(sanitizeInput('javascript:alert(1)')).not.toContain('javascript:')
  })

  it('elimina data: protocol', () => {
    expect(sanitizeInput('data:text/html,<h1>x</h1>')).not.toContain('data:')
  })

  it('elimina event handlers inline', () => {
    expect(sanitizeInput('onclick=alert(1)')).not.toContain('onclick=')
  })

  it('elimina entidades HTML numéricas', () => {
    // &#60; → '' y &#62; → '' (regex /&#\d+;?/ elimina ambas)
    expect(sanitizeInput('&#60;script&#62;')).toBe('script')
  })

  it('preserva texto normal', () => {
    expect(sanitizeInput('  Hola mundo  ')).toBe('Hola mundo')
  })
})

describe('sanitizeHTML', () => {
  it('escapa etiquetas HTML', () => {
    const result = sanitizeHTML('<b>bold</b>')
    expect(result).toBe('&lt;b&gt;bold&lt;/b&gt;')
  })

  it('preserva texto plano', () => {
    expect(sanitizeHTML('texto normal')).toBe('texto normal')
  })
})

describe('validateEmail', () => {
  it('acepta emails válidos', () => {
    expect(validateEmail('user@example.com')).toBe(true)
    expect(validateEmail('user+tag@domain.co.gt')).toBe(true)
  })

  it('rechaza emails inválidos', () => {
    expect(validateEmail('notanemail')).toBe(false)
    expect(validateEmail('@domain.com')).toBe(false)
    expect(validateEmail('user@')).toBe(false)
    expect(validateEmail('')).toBe(false)
  })

  it('es insensible a mayúsculas', () => {
    expect(validateEmail('USER@EXAMPLE.COM')).toBe(true)
  })
})

describe('validatePhoneNumber', () => {
  it('acepta E.164 internacionales', () => {
    expect(validatePhoneNumber('+50212345678')).toBe(true)
    expect(validatePhoneNumber('+1 800 555 1234')).toBe(true)
  })

  it('acepta números locales de 8 dígitos', () => {
    expect(validatePhoneNumber('12345678')).toBe(true)
    expect(validatePhoneNumber('1234-5678')).toBe(true)
  })

  it('rechaza números inválidos', () => {
    expect(validatePhoneNumber('123')).toBe(false)
    expect(validatePhoneNumber('abcdefgh')).toBe(false)
  })
})

describe('formatPhoneForWa', () => {
  it('convierte E.164 quitando el +', () => {
    expect(formatPhoneForWa('+50212345678')).toBe('50212345678')
  })

  it('agrega código de país por defecto a número local de 8 dígitos', () => {
    expect(formatPhoneForWa('12345678')).toBe('50212345678')
  })

  it('usa código de país personalizado', () => {
    expect(formatPhoneForWa('12345678', '503')).toBe('50312345678')
  })

  it('devuelve solo dígitos para formatos no reconocidos', () => {
    expect(formatPhoneForWa('abc')).toBe('')
  })
})

describe('validatePasswordStrength', () => {
  it('contraseña válida pasa todos los criterios', () => {
    const result = validatePasswordStrength('SecurePass1')
    expect(result.valid).toBe(true)
    expect(result.message).toBe('')
  })

  it('falla por longitud menor a 8', () => {
    expect(validatePasswordStrength('Ab1').valid).toBe(false)
    expect(validatePasswordStrength('Ab1').message).toContain('8 caracteres')
  })

  it('falla sin mayúscula', () => {
    expect(validatePasswordStrength('lowercase1').valid).toBe(false)
    expect(validatePasswordStrength('lowercase1').message).toContain('mayuscula')
  })

  it('falla sin minúscula', () => {
    expect(validatePasswordStrength('UPPERCASE1').valid).toBe(false)
    expect(validatePasswordStrength('UPPERCASE1').message).toContain('minuscula')
  })

  it('falla sin número', () => {
    expect(validatePasswordStrength('NoNumbers').valid).toBe(false)
    expect(validatePasswordStrength('NoNumbers').message).toContain('numero')
  })
})

describe('validateNumber', () => {
  it('acepta números dentro del rango', () => {
    expect(validateNumber(5, 0, 10)).toBe(true)
    expect(validateNumber(0, 0, 10)).toBe(true)
    expect(validateNumber(10, 0, 10)).toBe(true)
  })

  it('rechaza fuera del rango', () => {
    expect(validateNumber(-1, 0, 10)).toBe(false)
    expect(validateNumber(11, 0, 10)).toBe(false)
  })

  it('acepta strings numéricos', () => {
    expect(validateNumber('5', 0, 10)).toBe(true)
  })

  it('rechaza NaN y texto no numérico', () => {
    expect(validateNumber('abc', 0, 10)).toBe(false)
    expect(validateNumber(NaN, 0, 10)).toBe(false)
  })

  it('sin límites explícitos, solo valida que sea número', () => {
    expect(validateNumber(9999)).toBe(true)
    expect(validateNumber(-1)).toBe(false) // min=0 por defecto
  })
})
