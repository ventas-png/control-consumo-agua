// Pure helper: normalize either a legacy publicUrl or a bare path into the
// storage path of a given bucket. Lives in its own file so the test suite
// can import it without bringing in the Supabase client (which throws when
// env vars are absent, as they are during `vitest run`).

const PUBLIC_URL_RE = /\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?.*)?$/

/**
 * Returns the storage path inside `bucket` given either:
 *   - a bare path: 'visitantes/1234-abc.jpg' → 'visitantes/1234-abc.jpg'
 *   - a full publicUrl pointing at `bucket` → '<path>'
 *   - a full signed URL pointing at `bucket` → '<path>' (query string stripped)
 * Returns `null` if the value does not belong to the given bucket (e.g. an
 * external URL or a URL for a different bucket — caller should pass through
 * unchanged).
 */
export function extractBucketPath(value: string | null | undefined, bucket: string): string | null {
  if (!value) return null
  const match = value.match(PUBLIC_URL_RE)
  if (match) {
    const [, urlBucket, path] = match
    if (urlBucket !== bucket) return null
    return decodeURIComponent(path)
  }
  // External URLs and data URLs are not bucket paths — caller passes them through as-is.
  if (/^https?:\/\//.test(value) || /^data:/.test(value)) return null
  return value.replace(/^\/+/, '')
}
