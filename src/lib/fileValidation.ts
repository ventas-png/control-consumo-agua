// Client-side file validation: magic-byte verification + filename sanitization.
//
// Defense in depth: the `accept` HTML attribute and File.type from the browser
// are both controlled by the client and trivially spoofable. This module reads
// the first bytes of the file and matches them against well-known signatures
// to confirm the declared type. Used by ImageUploader and FileUploader before
// handing the buffer to Supabase Storage.
//
// IMPORTANT RESIDUAL RISK: a malicious authenticated user can still bypass
// these checks by calling the Supabase Storage REST API directly. True
// server-side enforcement requires either (a) an Edge Function that proxies
// the upload and re-validates magic bytes, or (b) storage policies + a
// post-upload validator that quarantines files with wrong magic. Both are
// tracked as follow-ups to S7 and depend on the S6 bucket-privacy work.

const MAGIC_SIGNATURES: { mime: string; bytes: number[]; offset?: number }[] = [
  // Raster images
  { mime: 'image/png',  bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  { mime: 'image/jpeg', bytes: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/gif',  bytes: [0x47, 0x49, 0x46, 0x38] },                          // GIF8
  { mime: 'image/webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },               // RIFF....WEBP
  // PDF
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },                     // %PDF
  // ZIP-based Office formats (.docx, .xlsx, .pptx)
  { mime: 'application/zip', bytes: [0x50, 0x4B, 0x03, 0x04] },                     // PK\x03\x04
  { mime: 'application/zip', bytes: [0x50, 0x4B, 0x05, 0x06] },                     // PK\x05\x06 (empty)
  { mime: 'application/zip', bytes: [0x50, 0x4B, 0x07, 0x08] },                     // PK\x07\x08 (spanned)
  // OLE2 (.doc, .xls — legacy Office)
  { mime: 'application/x-cfb', bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] },
]

// Categories — what shape we expect the upload to take. Each maps to a list
// of magic-signature MIME prefixes we accept.
export type FileCategory = 'image' | 'document'

const CATEGORY_MIMES: Record<FileCategory, string[]> = {
  image:    ['image/'],
  document: ['image/', 'application/pdf', 'application/zip', 'application/x-cfb'],
}

/**
 * Reads the first 16 bytes of a file and tries to match a known signature.
 * Returns the canonical mime string we detected, or `null` if no signature
 * matched (likely renamed file).
 */
export async function detectFileType(file: File): Promise<string | null> {
  const head = await file.slice(0, 16).arrayBuffer()
  const bytes = new Uint8Array(head)
  for (const sig of MAGIC_SIGNATURES) {
    const offset = sig.offset ?? 0
    if (bytes.length < offset + sig.bytes.length) continue
    let match = true
    for (let i = 0; i < sig.bytes.length; i++) {
      if (bytes[offset + i] !== sig.bytes[i]) { match = false; break }
    }
    if (match) return sig.mime
  }
  return null
}

/**
 * Verifies that the file's actual content matches what we expect for a
 * given upload category. Returns `{ ok: true, detected }` on success or
 * `{ ok: false, reason }` on failure (caller surfaces the reason to the user).
 */
export async function validateFileMagic(
  file: File,
  category: FileCategory,
): Promise<{ ok: true; detected: string } | { ok: false; reason: string }> {
  const detected = await detectFileType(file)
  if (!detected) {
    return { ok: false, reason: 'No se reconoce el formato del archivo. Subí un PNG, JPG, WebP, PDF o documento Office.' }
  }
  const allowed = CATEGORY_MIMES[category]
  const isAllowed = allowed.some(prefix => detected.startsWith(prefix) || detected === prefix)
  if (!isAllowed) {
    return { ok: false, reason: `El contenido del archivo no coincide con un ${category === 'image' ? 'imagen' : 'documento'} válido.` }
  }
  return { ok: true, detected }
}

/**
 * Build a safe upload path: strip path separators, control chars and any
 * character that's not alphanumeric/dash/underscore/dot. Also caps length.
 * Prevents:
 *   - Path traversal: "../../../etc/passwd"
 *   - Bucket-key collisions via odd characters
 *   - Filenames that turn into XSS when served as text/html
 */
export function sanitizeUploadFilename(name: string, maxLength = 60): string {
  // Keep only the basename and at most one extension
  const base = name.split(/[\\/]/).pop() ?? 'archivo'
  const lastDot = base.lastIndexOf('.')
  const stem = (lastDot > 0 ? base.slice(0, lastDot) : base).slice(0, maxLength)
  const ext  = (lastDot > 0 ? base.slice(lastDot + 1) : '').slice(0, 10)
  const cleanStem = stem.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'archivo'
  const cleanExt  = ext.replace(/[^\w]+/g, '').toLowerCase()
  return cleanExt ? `${cleanStem}.${cleanExt}` : cleanStem
}

/**
 * Builds the full storage object path: `<folder>/<timestamp>-<random>-<safeName>`.
 * The timestamp + random suffix make accidental collisions vanishingly unlikely
 * and avoid enumeration of the bucket via predictable URLs.
 */
export function buildUploadPath(folder: string, originalName: string, forcedExt?: string): string {
  const safe = sanitizeUploadFilename(originalName)
  const finalName = forcedExt
    ? `${safe.replace(/\.[^.]+$/, '')}.${forcedExt.replace(/[^\w]+/g, '').toLowerCase()}`
    : safe
  const safeFolder = folder.replace(/[^\w/-]+/g, '-').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '')
  return `${safeFolder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${finalName}`
}
