// Validación de uploads server-side (infra:I13). PURA y runtime-agnóstica: sin
// Deno ni supabase-js → corre directo en vitest (patrón I22). La edge function
// `validate-upload` la usa para hacer cumplir, del lado del servidor, lo que el
// cliente (src/lib/fileValidation.ts) solo puede sugerir:
//
//   1. magic-bytes vs MIME declarado  → bloquea un PNG renombrado a .pdf, etc.
//   2. tamaño máximo por bucket        → bloquea archivos sobre el límite.
//   3. saneo/rechazo de SVG peligroso  → <script>, on*=, javascript:, ENTITY…
//      (img-src de la CSP permite blob:/data:, así que un SVG con script subido
//       y luego servido sería XSS almacenado).
//
// Esto va ADEMÁS del `allowed_mime_types` del bucket (defensa en profundidad):
// el bucket filtra el content-type declarado, pero no mira el contenido real.
//
// Espejo de la lógica de magic-bytes de src/lib/fileValidation.ts. Si se agrega
// una firma allá, agregarla acá también (el cliente no se importa desde Deno).

export interface MagicSignature {
  mime: string
  bytes: number[]
  offset?: number
}

export const MAGIC_SIGNATURES: MagicSignature[] = [
  // Imágenes raster
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF8
  { mime: 'image/webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }, // RIFF....WEBP
  // PDF
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  // Office basado en ZIP (.docx, .xlsx, .pptx)
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04] }, // PK\x03\x04
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x05, 0x06] }, // PK\x05\x06 (vacío)
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x07, 0x08] }, // PK\x07\x08 (spanned)
  // OLE2/CFB (.doc, .xls legacy)
  { mime: 'application/x-cfb', bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
]

/** Detecta el tipo real por magic-bytes. Devuelve el MIME canónico o null. */
export function detectMagic(bytes: Uint8Array): string | null {
  for (const sig of MAGIC_SIGNATURES) {
    const offset = sig.offset ?? 0
    if (bytes.length < offset + sig.bytes.length) continue
    let match = true
    for (let i = 0; i < sig.bytes.length; i++) {
      if (bytes[offset + i] !== sig.bytes[i]) {
        match = false
        break
      }
    }
    if (match) return sig.mime
  }
  return null
}

// MIME declarado → magic-bytes que se consideran consistentes con él.
const DECLARED_TO_MAGIC: Record<string, string[]> = {
  'image/png': ['image/png'],
  'image/jpeg': ['image/jpeg'],
  'image/jpg': ['image/jpeg'],
  'image/gif': ['image/gif'],
  'image/webp': ['image/webp'],
  'application/pdf': ['application/pdf'],
  'application/zip': ['application/zip'],
  // Office moderno (OOXML) = contenedor ZIP
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['application/zip'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['application/zip'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['application/zip'],
  // Office legacy = contenedor OLE2/CFB
  'application/msword': ['application/x-cfb'],
}

// MIME declarados que NO tienen magic-bytes fiables (texto). No se pueden
// verificar por contenido; el bucket allow-list + tamaño son la defensa.
const MAGIC_EXEMPT = new Set<string>([
  'text/csv',
  'application/vnd.ms-excel', // .xls (CFB) o .csv mal etiquetado según el SO
])

export const SVG_MIME = 'image/svg+xml'

/** ¿El contenido parece un SVG? (declaración o sniff del contenido). */
export function looksLikeSvg(bytes: Uint8Array, declaredMime?: string): boolean {
  if (declaredMime && declaredMime.toLowerCase().includes('svg')) return true
  // Sniff: decodifica el inicio y busca una raíz <svg tras BOM/espacios/decl/doctype/comentarios.
  const head = decodeUtf8(bytes.subarray(0, 1024))
    .replace(/^﻿/, '')
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trimStart()
  return /^<svg[\s>]/i.test(head)
}

// Patrones peligrosos dentro de un SVG (XSS almacenado si luego se renderiza).
const SVG_DANGEROUS_PATTERNS: RegExp[] = [
  /<script[\s/>]/i, // <script>
  /\son[a-z]+\s*=/i, // onload=, onerror=, onclick=…
  /javascript:/i, // href="javascript:…"
  /<foreignObject[\s/>]/i, // permite HTML arbitrario dentro del SVG
  /<iframe[\s/>]/i,
  /<embed[\s/>]/i,
  /<object[\s/>]/i,
  /<!ENTITY/i, // XXE / expansión de entidades
  /<set[\s/>]/i, // SMIL: <set attributeName="onload" …>
  /<animate[^>]*\bonbegin/i,
]

/** ¿El SVG (texto) contiene contenido activo/peligroso? */
export function svgIsDangerous(svgText: string): boolean {
  return SVG_DANGEROUS_PATTERNS.some((re) => re.test(svgText))
}

export interface BucketPolicy {
  /** Tamaño máximo en bytes. */
  maxBytes: number
  /** Si el bucket admite SVG (clean). Por defecto false: SVG es vector XSS. */
  allowSvg: boolean
}

const MiB = 1024 * 1024

// Topes por bucket (espejo de los file_size_limit de las migraciones de storage).
// allowSvg=false en todos: ningún bucket declara image/svg+xml a propósito.
export const BUCKET_POLICIES: Record<string, BucketPolicy> = {
  'company-logos': { maxBytes: 2 * MiB, allowSvg: false },
  'project-logos': { maxBytes: 2 * MiB, allowSvg: false },
  'condominios-media': { maxBytes: 10 * MiB, allowSvg: false },
  'mudanza-docs': { maxBytes: 10 * MiB, allowSvg: false },
  'pagos-comprobantes': { maxBytes: 10 * MiB, allowSvg: false },
  'registro-fotos': { maxBytes: 10 * MiB, allowSvg: false },
  'conv-attachments': { maxBytes: 10 * MiB, allowSvg: false },
  'report-attachments': { maxBytes: 25 * MiB, allowSvg: false },
}

export const DEFAULT_BUCKET_POLICY: BucketPolicy = { maxBytes: 10 * MiB, allowSvg: false }

export function policyForBucket(bucket: string): BucketPolicy {
  return BUCKET_POLICIES[bucket] ?? DEFAULT_BUCKET_POLICY
}

export type RejectionCode =
  | 'empty'
  | 'too_large'
  | 'svg_unsafe'
  | 'svg_not_allowed'
  | 'magic_mismatch'
  | 'unknown_format'
  | 'mime_not_allowed'

export interface UploadInput {
  bucket: string
  /** content-type declarado por el cliente (file.type / form field). */
  declaredMime: string
  /** bytes del archivo. */
  bytes: Uint8Array
  filename?: string
}

export type UploadValidationResult =
  | { ok: true; detected: string }
  | { ok: false; code: RejectionCode; reason: string }

/**
 * Valida un upload combabinando tamaño, magic-bytes vs MIME declarado y saneo
 * de SVG. Devuelve `{ ok }` o `{ ok: false, code, reason }` (en español).
 */
export function validateUpload(input: UploadInput): UploadValidationResult {
  const { bucket, bytes } = input
  const declaredMime = (input.declaredMime ?? '').toLowerCase().split(';')[0].trim()
  const policy = policyForBucket(bucket)

  if (!bytes || bytes.length === 0) {
    return { ok: false, code: 'empty', reason: 'El archivo está vacío.' }
  }

  // 1) Tamaño por bucket.
  if (bytes.length > policy.maxBytes) {
    const mb = (policy.maxBytes / MiB).toFixed(0)
    return { ok: false, code: 'too_large', reason: `El archivo supera el límite de ${mb} MB para este destino.` }
  }

  // 2) SVG: saneo/rechazo (antes de magic-bytes, que no aplican a texto).
  if (looksLikeSvg(bytes, declaredMime)) {
    const text = decodeUtf8(bytes)
    if (svgIsDangerous(text)) {
      return { ok: false, code: 'svg_unsafe', reason: 'El SVG contiene contenido activo (script/eventos) y fue rechazado.' }
    }
    if (!policy.allowSvg) {
      return { ok: false, code: 'svg_not_allowed', reason: 'Este destino no admite archivos SVG.' }
    }
    return { ok: true, detected: SVG_MIME }
  }

  // 3) magic-bytes vs MIME declarado.
  const expected = DECLARED_TO_MAGIC[declaredMime]
  const detected = detectMagic(bytes)

  if (expected) {
    if (detected === null) {
      return { ok: false, code: 'magic_mismatch', reason: 'El contenido del archivo no coincide con el tipo declarado.' }
    }
    if (!expected.includes(detected)) {
      return { ok: false, code: 'magic_mismatch', reason: 'El contenido del archivo no coincide con el tipo declarado (posible archivo renombrado).' }
    }
    return { ok: true, detected }
  }

  // MIME declarado sin magic fiable (texto): se acepta si no hay firma binaria
  // contradictoria. Un .csv real no tiene firma (detected null) → ok; un binario
  // renombrado a .csv sí tendría firma → mismatch.
  if (MAGIC_EXEMPT.has(declaredMime)) {
    if (detected !== null) {
      return { ok: false, code: 'magic_mismatch', reason: 'El contenido del archivo no coincide con el tipo declarado (posible archivo renombrado).' }
    }
    return { ok: true, detected: declaredMime }
  }

  // MIME declarado desconocido para el validador → rechazo (defensa en profundidad;
  // el bucket allow-list ya debería haberlo filtrado).
  return { ok: false, code: 'mime_not_allowed', reason: `El tipo de archivo "${declaredMime || 'desconocido'}" no está permitido.` }
}

/** Decodifica bytes a UTF-8 sin depender de TextDecoder global (Deno y Node lo tienen). */
function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}
