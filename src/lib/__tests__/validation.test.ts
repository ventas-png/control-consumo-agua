import { describe, it, expect } from 'vitest'
import DOMPurify from 'dompurify'
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
  it('elimina etiquetas <script> incluyendo su contenido', () => {
    expect(sanitizeInput('<script>alert(1)</script>')).toBe('')
  })

  it('elimina etiquetas pero preserva su texto plano', () => {
    expect(sanitizeInput('<b>bold</b>')).toBe('bold')
    expect(sanitizeInput('<a href="javascript:foo">click</a>')).toBe('click')
  })

  it('elimina vectores XSS comunes (img onerror, svg onload, iframe)', () => {
    expect(sanitizeInput('<img src=x onerror=alert(1)>')).toBe('')
    expect(sanitizeInput('<svg onload=alert(1)>')).toBe('')
    expect(sanitizeInput('<iframe src="evil"></iframe>')).toBe('')
  })

  it('preserva texto que parece código pero no es HTML', () => {
    // El sanitize anterior (blacklist) eliminaba estas substrings hasta en texto
    // plano, lo cual era overkill. DOMPurify solo desactiva HTML real; el texto
    // plano se entrega tal cual porque en JSX/PDF/CSV no se interpreta.
    expect(sanitizeInput('javascript:alert(1)')).toBe('javascript:alert(1)')
    expect(sanitizeInput('onclick=foo')).toBe('onclick=foo')
  })

  it('preserva texto normal y limpia whitespace en bordes', () => {
    expect(sanitizeInput('  Hola mundo  ')).toBe('Hola mundo')
  })

  it('cuerpos vacíos o nullish devuelven cadena vacía', () => {
    expect(sanitizeInput('')).toBe('')
  })
})

// Regresión del advisory GHSA-55q2-fjhq-7xh7 (DOMPurify <= 3.4.12: la
// remoción de un hook con IN_PLACE dejaba un subárbol desprendido ejecutable).
// El fix vive en la librería; lo que se fija AQUÍ es (a) que el lockfile no
// pueda volver al rango afectado sin que un test lo grite, y (b) que los
// vectores de mutación que este tipo de bug explota mueran en NUESTRO wrapper,
// que es la única superficie que la app expone.
describe('sanitizeInput · regresión del advisory de DOMPurify', () => {
  it('la versión instalada quedó fuera del rango afectado (<= 3.4.12)', () => {
    const [major, minor, patch] = DOMPurify.version.split('.').map(Number)
    const fueraDelRango =
      major > 3 || (major === 3 && (minor > 4 || (minor === 4 && patch >= 13)))
    expect(fueraDelRango,
      `dompurify@${DOMPurify.version} está dentro del rango vulnerable de GHSA-55q2-fjhq-7xh7`,
    ).toBe(true)
  })

  it('mata los vectores de mutación mXSS (svg/style, math/mglyph, anidados)', () => {
    // Payloads clásicos de mutation-XSS: el parser reubica el subárbol al
    // re-serializar y un sanitizador ingenuo deja vivo el <img onerror>.
    const vectores = [
      '<svg><p><style><!--</style><img src=x onerror=alert(1)>--></p></svg>',
      '<math><mtext><table><mglyph><style><!--</style><img src=x onerror=alert(1)>',
      '<form><math><mtext></form><form><mglyph><style></math><img src=x onerror=alert(1)>',
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
      '<template><img src=x onerror=alert(1)></template>',
      '<svg></p><style><a id="</style><img src=x onerror=alert(1)>">',
    ]
    for (const v of vectores) {
      const out = sanitizeInput(v)
      expect(out, `sobrevivió markup en: ${v}`).not.toMatch(/[<>]/)
      expect(out.toLowerCase(), `sobrevivió un handler en: ${v}`).not.toContain('onerror=')
    }
  })

  it('mata variantes codificadas y URLs javascript: en atributos', () => {
    expect(sanitizeInput('<a href="jav&#x09;ascript:alert(1)">x</a>')).toBe('x')
    expect(sanitizeInput('<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;">')).toBe('')
    expect(sanitizeInput('<img src=x oNeRrOr=alert(1)>')).toBe('')
  })

  it('IN_PLACE sobre un nodo vivo no deja contenido ejecutable (forma del advisory)', () => {
    // La app no usa IN_PLACE, pero es el modo del advisory: si una futura
    // versión lo reabre, esto falla sin depender de nuestro wrapper.
    const div = document.createElement('div')
    div.innerHTML = '<b>ok</b><img src="x" onerror="alert(1)"><script>alert(2)</script>'
    DOMPurify.sanitize(div, { IN_PLACE: true, ALLOWED_TAGS: ['div', 'b', 'img'], ALLOWED_ATTR: ['src'] })
    expect(div.innerHTML).toContain('<b>ok</b>')
    expect(div.innerHTML).not.toContain('onerror')
    expect(div.innerHTML).not.toContain('script')
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
