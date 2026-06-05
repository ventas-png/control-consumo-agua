// Tests de la validación de uploads server-side (infra:I13). Puros: validateUpload
// opera sobre Uint8Array sin Deno ni supabase-js, así que corre directo en vitest
// (patrón I22, igual que validate.ts / rateLimit.ts).

import { describe, it, expect } from 'vitest'
import {
  detectMagic,
  looksLikeSvg,
  svgIsDangerous,
  validateUpload,
  policyForBucket,
  BUCKET_POLICIES,
} from '../uploadValidation.ts'

// Firmas magic conocidas para construir fixtures.
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]
const PDF = [0x25, 0x50, 0x44, 0x46] // %PDF
const ZIP = [0x50, 0x4b, 0x03, 0x04] // PK..
const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50] // RIFF....WEBP

/** Bytes a partir de una firma + relleno opcional. */
function bytes(sig: number[], padTo = 0): Uint8Array {
  const len = Math.max(sig.length, padTo)
  const out = new Uint8Array(len)
  out.set(sig, 0)
  return out
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

describe('detectMagic', () => {
  it('reconoce PNG, JPEG, PDF, ZIP, CFB, WEBP', () => {
    expect(detectMagic(bytes(PNG))).toBe('image/png')
    expect(detectMagic(bytes(JPEG))).toBe('image/jpeg')
    expect(detectMagic(bytes(PDF))).toBe('application/pdf')
    expect(detectMagic(bytes(ZIP))).toBe('application/zip')
    expect(detectMagic(bytes(CFB))).toBe('application/x-cfb')
    expect(detectMagic(bytes(WEBP))).toBe('image/webp')
  })

  it('devuelve null para bytes desconocidos', () => {
    expect(detectMagic(utf8('hola mundo, esto es texto plano'))).toBeNull()
  })
})

describe('SVG sniffing y saneo', () => {
  it('detecta SVG por contenido aunque no se declare el MIME', () => {
    expect(looksLikeSvg(utf8('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(true)
    expect(looksLikeSvg(utf8('<?xml version="1.0"?>\n<!-- c -->\n<svg></svg>'))).toBe(true)
    expect(looksLikeSvg(utf8('<html></html>'))).toBe(false)
  })

  it('marca como peligroso script, on*=, javascript:, foreignObject, ENTITY', () => {
    expect(svgIsDangerous('<svg><script>alert(1)</script></svg>')).toBe(true)
    expect(svgIsDangerous('<svg onload="alert(1)"></svg>')).toBe(true)
    expect(svgIsDangerous('<svg><a href="javascript:alert(1)">x</a></svg>')).toBe(true)
    expect(svgIsDangerous('<svg><foreignObject><body>x</body></foreignObject></svg>')).toBe(true)
    expect(svgIsDangerous('<!DOCTYPE svg [<!ENTITY x "y">]><svg></svg>')).toBe(true)
  })

  it('no marca un SVG limpio', () => {
    expect(svgIsDangerous('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')).toBe(false)
  })
})

describe('validateUpload — casos de la DoD', () => {
  it('RECHAZA un PNG renombrado a .pdf (magic-byte mismatch)', () => {
    const r = validateUpload({ bucket: 'pagos-comprobantes', declaredMime: 'application/pdf', bytes: bytes(PNG, 64), filename: 'fake.pdf' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('magic_mismatch')
  })

  it('RECHAZA un SVG con <script> (XSS almacenado)', () => {
    const svg = utf8('<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/steal")</script></svg>')
    const r = validateUpload({ bucket: 'conv-attachments', declaredMime: 'image/svg+xml', bytes: svg, filename: 'x.svg' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('svg_unsafe')
  })

  it('RECHAZA un archivo sobre el límite del bucket', () => {
    const max = policyForBucket('company-logos').maxBytes
    const big = bytes(PNG, max + 1)
    const r = validateUpload({ bucket: 'company-logos', declaredMime: 'image/png', bytes: big, filename: 'huge.png' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('too_large')
  })
})

describe('validateUpload — aceptaciones y otros rechazos', () => {
  it('acepta un PNG real declarado image/png', () => {
    const r = validateUpload({ bucket: 'registro-fotos', declaredMime: 'image/png', bytes: bytes(PNG, 128) })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.detected).toBe('image/png')
  })

  it('acepta un PDF real declarado application/pdf', () => {
    const r = validateUpload({ bucket: 'pagos-comprobantes', declaredMime: 'application/pdf', bytes: bytes(PDF, 128) })
    expect(r.ok).toBe(true)
  })

  it('acepta un .docx (contenedor ZIP) declarado como OOXML', () => {
    const r = validateUpload({
      bucket: 'conv-attachments',
      declaredMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: bytes(ZIP, 128),
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.detected).toBe('application/zip')
  })

  it('acepta un CSV real (texto, sin magic) declarado text/csv', () => {
    const r = validateUpload({ bucket: 'report-attachments', declaredMime: 'text/csv', bytes: utf8('a,b,c\n1,2,3\n') })
    expect(r.ok).toBe(true)
  })

  it('RECHAZA un binario renombrado a .csv (tiene firma pero text/csv no debería)', () => {
    const r = validateUpload({ bucket: 'report-attachments', declaredMime: 'text/csv', bytes: bytes(PNG, 64) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('magic_mismatch')
  })

  it('RECHAZA un SVG limpio en bucket que no admite SVG', () => {
    const svg = utf8('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')
    const r = validateUpload({ bucket: 'company-logos', declaredMime: 'image/svg+xml', bytes: svg })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('svg_not_allowed')
  })

  it('RECHAZA un MIME no contemplado', () => {
    const r = validateUpload({ bucket: 'conv-attachments', declaredMime: 'application/x-msdownload', bytes: bytes([0x4d, 0x5a], 64) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('mime_not_allowed')
  })

  it('RECHAZA un archivo vacío', () => {
    const r = validateUpload({ bucket: 'registro-fotos', declaredMime: 'image/png', bytes: new Uint8Array(0) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('empty')
  })

  it('RECHAZA un PDF declarado pero con contenido no-PDF (magic null)', () => {
    const r = validateUpload({ bucket: 'pagos-comprobantes', declaredMime: 'application/pdf', bytes: utf8('no soy un pdf') })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('magic_mismatch')
  })
})

describe('políticas de bucket', () => {
  it('todos los buckets conocidos rechazan SVG por defecto (allowSvg=false)', () => {
    for (const p of Object.values(BUCKET_POLICIES)) expect(p.allowSvg).toBe(false)
  })

  it('cae a la política por defecto para un bucket desconocido', () => {
    expect(policyForBucket('bucket-inexistente').maxBytes).toBeGreaterThan(0)
  })
})
