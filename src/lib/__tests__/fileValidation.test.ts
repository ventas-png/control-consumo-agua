import { describe, it, expect } from 'vitest'
import {
  detectFileType, validateFileMagic,
  sanitizeUploadFilename, buildUploadPath,
} from '../fileValidation'

// Build a File whose first bytes match a magic signature.
function makeFile(headerBytes: number[], name = 'test.bin', type = 'application/octet-stream'): File {
  const buffer = new Uint8Array(64)
  headerBytes.forEach((b, i) => { buffer[i] = b })
  return new File([buffer], name, { type })
}

describe('detectFileType', () => {
  it('reconoce PNG', async () => {
    const f = makeFile([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 'x.png')
    expect(await detectFileType(f)).toBe('image/png')
  })
  it('reconoce JPEG', async () => {
    const f = makeFile([0xFF, 0xD8, 0xFF, 0xE0])
    expect(await detectFileType(f)).toBe('image/jpeg')
  })
  it('reconoce PDF', async () => {
    const f = makeFile([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31])
    expect(await detectFileType(f)).toBe('application/pdf')
  })
  it('reconoce ZIP (docx/xlsx)', async () => {
    const f = makeFile([0x50, 0x4B, 0x03, 0x04])
    expect(await detectFileType(f)).toBe('application/zip')
  })
  it('reconoce WebP con offset 8 (RIFF....WEBP)', async () => {
    const f = makeFile([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
    expect(await detectFileType(f)).toBe('image/webp')
  })
  it('devuelve null para contenido sin signature conocida', async () => {
    const f = makeFile([0x00, 0x00, 0x00, 0x00])
    expect(await detectFileType(f)).toBeNull()
  })
})

describe('validateFileMagic', () => {
  it('acepta PNG bajo categoría image', async () => {
    const f = makeFile([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 'foo.png', 'image/png')
    const r = await validateFileMagic(f, 'image')
    expect(r.ok).toBe(true)
  })
  it('rechaza PDF bajo categoría image', async () => {
    const f = makeFile([0x25, 0x50, 0x44, 0x46], 'foo.pdf', 'image/png')
    const r = await validateFileMagic(f, 'image')
    expect(r.ok).toBe(false)
  })
  it('acepta PDF bajo categoría document', async () => {
    const f = makeFile([0x25, 0x50, 0x44, 0x46], 'foo.pdf', 'application/pdf')
    const r = await validateFileMagic(f, 'document')
    expect(r.ok).toBe(true)
  })
  it('rechaza un archivo renombrado .png que no es imagen real', async () => {
    // Atacante sube payload.html con MIME image/png falsificado
    const f = makeFile([0x3C, 0x68, 0x74, 0x6D, 0x6C, 0x3E], 'evil.png', 'image/png')
    const r = await validateFileMagic(f, 'image')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/formato/i)
  })
})

describe('sanitizeUploadFilename', () => {
  it('quita path traversal', () => {
    expect(sanitizeUploadFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeUploadFilename('foo/../bar.txt')).toBe('bar.txt')
  })
  it('reemplaza caracteres especiales por guion', () => {
    expect(sanitizeUploadFilename('Hola Mundo!@#.pdf')).toBe('Hola-Mundo.pdf')
  })
  it('preserva alfanuméricos, guion, underscore, punto', () => {
    expect(sanitizeUploadFilename('archivo_2024-01_v1.xlsx')).toBe('archivo_2024-01_v1.xlsx')
  })
  it('cap a longitud máxima', () => {
    const long = 'a'.repeat(200) + '.pdf'
    expect(sanitizeUploadFilename(long, 30)).toBe('a'.repeat(30) + '.pdf')
  })
  it('quita extensión maliciosamente larga', () => {
    expect(sanitizeUploadFilename('foo.' + 'x'.repeat(50))).toBe('foo.xxxxxxxxxx')
  })
  it('fallback cuando no hay base', () => {
    expect(sanitizeUploadFilename('---')).toBe('archivo')
    expect(sanitizeUploadFilename('')).toBe('archivo')
  })
})

describe('buildUploadPath', () => {
  it('forma path con folder + timestamp + random + safeName', () => {
    const p = buildUploadPath('mudanzas/foo', 'mi archivo!.pdf')
    expect(p).toMatch(/^mudanzas\/foo\/\d{13}-[a-z0-9]{6}-mi-archivo\.pdf$/)
  })
  it('sanea el folder', () => {
    const p = buildUploadPath('mudan zas//../foo', 'doc.pdf')
    expect(p).not.toContain('..')
    expect(p).not.toContain('//')
  })
  it('aplica forcedExt sobre el nombre saneado', () => {
    const p = buildUploadPath('imgs', 'foto.png', 'jpg')
    expect(p).toMatch(/foto\.jpg$/)
    expect(p).not.toContain('.png')
  })
})
