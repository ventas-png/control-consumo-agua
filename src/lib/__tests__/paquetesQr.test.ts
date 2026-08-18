// Contrato del QR de retiro de paquetes.
//
// Bug que originó esta suite: el QR llevaba el texto plano `PAQUETE:<código>`.
// La cámara nativa del teléfono solo ofrece una acción cuando reconoce el
// formato del contenido; ante ese esquema desconocido respondía "No se
// encontraron datos utilizables" y el guardia no podía escanear nada. El QR
// lleva ahora una URL de la app, y el código viaja en el FRAGMENTO para que no
// llegue al servidor ni al header Referer.
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  qrPayloadRetiro,
  codigoRetiroDesdeURL,
  normalizarCodigoRetiro,
  appOriginParaQR,
  RETIRO_PATH,
} from '../paquetes'

describe('qrPayloadRetiro', () => {
  it('es una URL absoluta (la cámara del teléfono solo actúa sobre formatos que reconoce)', () => {
    const payload = qrPayloadRetiro('ABC23456')
    expect(payload).toMatch(/^https:\/\//)
    expect(() => new URL(payload)).not.toThrow()
  })

  it('apunta a portería y lleva el código en el fragmento, nunca en el query', () => {
    const url = new URL(qrPayloadRetiro('ABC23456'))
    expect(url.pathname).toBe(RETIRO_PATH)
    expect(url.hash).toBe('#retiro=ABC23456')
    expect(url.search).toBe('')
  })

  it('no deja el código en la parte de la URL que viaja al servidor', () => {
    const payload = qrPayloadRetiro('SECRET42')
    expect(payload.split('#')[0]).not.toContain('SECRET42')
  })

  it('usa el origen público cuando el origen real no sirve para un QR', () => {
    // jsdom corre en http://localhost — un QR con ese origen no abre nada en el
    // teléfono del guardia, igual que el https://localhost del WebView nativo.
    expect(appOriginParaQR()).toBe('https://administratodo.com')
  })
})

describe('appOriginParaQR', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('respeta VITE_APP_URL y le quita la barra final', () => {
    vi.stubEnv('VITE_APP_URL', 'https://condominio.ejemplo.com/')
    expect(appOriginParaQR()).toBe('https://condominio.ejemplo.com')
    expect(qrPayloadRetiro('ABC23456')).toBe('https://condominio.ejemplo.com/condominios/paqueteria#retiro=ABC23456')
  })

  it('ignora un VITE_APP_URL de desarrollo: el teléfono del guardia no resuelve loopback', () => {
    vi.stubEnv('VITE_APP_URL', 'http://localhost:5173')
    expect(appOriginParaQR()).toBe('https://administratodo.com')
  })

  it('ignora un VITE_APP_URL que no es http(s)', () => {
    vi.stubEnv('VITE_APP_URL', 'capacitor://localhost')
    expect(appOriginParaQR()).toBe('https://administratodo.com')
  })
})

describe('codigoRetiroDesdeURL', () => {
  it('lee el fragmento suelto', () => {
    expect(codigoRetiroDesdeURL('#retiro=ABC23456')).toBe('ABC23456')
  })

  it('lee el código desde la URL completa del QR', () => {
    expect(codigoRetiroDesdeURL(qrPayloadRetiro('RUKJ2BW7'))).toBe('RUKJ2BW7')
  })

  it('normaliza a mayúsculas y descarta espacios', () => {
    expect(codigoRetiroDesdeURL('#retiro=abc23456 ')).toBe('ABC23456')
  })

  it('corta en el siguiente separador si el fragmento lleva más claves', () => {
    expect(codigoRetiroDesdeURL('#retiro=ABC23456&otro=1')).toBe('ABC23456')
  })

  it('devuelve null cuando no hay código', () => {
    expect(codigoRetiroDesdeURL('')).toBeNull()
    expect(codigoRetiroDesdeURL(null)).toBeNull()
    expect(codigoRetiroDesdeURL('#')).toBeNull()
    expect(codigoRetiroDesdeURL('#retiro=')).toBeNull()
    expect(codigoRetiroDesdeURL('/condominios/paqueteria')).toBeNull()
  })
})

describe('normalizarCodigoRetiro (lo que el guardia teclea o pega)', () => {
  it('acepta el código a secas', () => {
    expect(normalizarCodigoRetiro('abc23456')).toBe('ABC23456')
    expect(normalizarCodigoRetiro('  ABC23456  ')).toBe('ABC23456')
  })

  it('acepta la URL del QR pegada entera', () => {
    expect(normalizarCodigoRetiro(qrPayloadRetiro('ABC23456'))).toBe('ABC23456')
  })

  it('acepta el payload viejo PAQUETE:<código> de los QR ya impresos', () => {
    expect(normalizarCodigoRetiro('PAQUETE:ABC23456')).toBe('ABC23456')
    expect(normalizarCodigoRetiro('paquete:abc23456')).toBe('ABC23456')
  })

  it('vacío entra, vacío sale (no valida contra ningún paquete)', () => {
    expect(normalizarCodigoRetiro('')).toBe('')
    expect(normalizarCodigoRetiro(null)).toBe('')
    expect(normalizarCodigoRetiro('   ')).toBe('')
  })
})
