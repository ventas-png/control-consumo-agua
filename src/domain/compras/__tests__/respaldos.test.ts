// Respaldos de recepción — lo que el navegador comprueba antes de subir. El acceso privado por
// empresa/proyecto, los límites, la trazabilidad y el congelamiento los hace cumplir el servidor
// (supabase/tests/compras_bloque_b/assert_respaldos.sql).
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))

import { MAX_BYTES_RESPALDO, nombreSeguroRespaldo, rutaRespaldoRecepcion, sha256Archivo, validarArchivoRespaldo } from '../respaldos'

const archivo = (type: string, size: number, name = 'a') => ({ name, type, size })

describe('validarArchivoRespaldo', () => {
  it('acepta PDF, JPG, PNG y WEBP', () => {
    for (const t of ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']) {
      expect(validarArchivoRespaldo(archivo(t, 1000))).toBeNull()
    }
  })
  it('rechaza otros tipos (zip, exe, html, svg)', () => {
    for (const t of ['application/zip', 'application/x-msdownload', 'text/html', 'image/svg+xml', '']) {
      expect(validarArchivoRespaldo(archivo(t, 1000))).toMatch(/PDF, JPG, PNG o WEBP/)
    }
  })
  it('respeta el límite de 10 MB y rechaza archivos vacíos', () => {
    expect(validarArchivoRespaldo(archivo('application/pdf', MAX_BYTES_RESPALDO))).toBeNull()
    expect(validarArchivoRespaldo(archivo('application/pdf', MAX_BYTES_RESPALDO + 1))).toMatch(/10 MB/)
    expect(validarArchivoRespaldo(archivo('application/pdf', 0))).toMatch(/vacío/)
  })
})

describe('ruta y nombre', () => {
  it('la ruta lleva empresa/proyecto/recepción/archivo y «empresa» sin proyecto', () => {
    expect(rutaRespaldoRecepcion('c', 'p', 'r', 'a.pdf')).toBe('c/p/r/a.pdf')
    expect(rutaRespaldoRecepcion('c', null, 'r', 'a.pdf')).toBe('c/empresa/r/a.pdf')
  })
  it('el nombre es simple: sin rutas, acentos ni espacios, y con el sufijo único', () => {
    const n = nombreSeguroRespaldo('../Remisión nº 123 (final).PDF', 'application/pdf', 'abc123')
    expect(n).toMatch(/^[A-Za-z0-9._-]+$/)
    expect(n).toBe('Remision-n-123-final-abc123.pdf')
    expect(nombreSeguroRespaldo('???', 'image/png', 'x')).toBe('respaldo-x.png')
  })
  it('la extensión sale del tipo real, no del nombre que trae el archivo', () => {
    expect(nombreSeguroRespaldo('foto.exe', 'image/jpeg', 'x')).toBe('foto-x.jpg')
  })
})

describe('sha256Archivo', () => {
  it('es la huella SHA-256 en hexadecimal y determinista', async () => {
    const b = new TextEncoder().encode('abc').buffer as ArrayBuffer
    expect(await sha256Archivo(b)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
