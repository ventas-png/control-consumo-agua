// Signed-URL helpers for private (or about-to-be-private) Supabase Storage buckets.
//
// Background: see S6 in the 2026-05-16 security audit. The `condominios-media`
// bucket is being migrated from public to private. To avoid breaking display
// sites mid-migration, this module accepts BOTH the legacy publicUrl form
// (https://<host>/storage/v1/object/public/<bucket>/<path>) and the bare
// `<path>` form. `extractBucketPath` is the normalizer (kept in its own pure
// module so tests can import it without bootstrapping Supabase).
//
// Display sites use the React hook `useSignedUrl(value, bucket)` or the
// `<SecureImage>` component to render media. They render a signed URL with a
// 1h TTL and auto-refresh shortly before expiration, so a long-open tab keeps
// working without re-fetching the row.

import { useEffect, useState, useRef } from 'react'
import { supabase } from './supabase'
import { extractBucketPath } from './extractBucketPath'

export { extractBucketPath } from './extractBucketPath'

// Default TTL for signed URLs (in seconds). 1h is a reasonable balance
// between caching at the browser/CDN edge and limiting the lifetime of a
// leaked URL.
const DEFAULT_TTL = 3600
// Refresh the signed URL this long before its expiration so the <img> never
// hits a 403. Conservative — refreshes well before TTL/2.
const REFRESH_LEAD_MS = 5 * 60 * 1000

/**
 * React hook that returns a signed URL for the given value (path or legacy URL).
 * Re-signs ~5 min before expiration so a long-open tab never hits a 403.
 *
 *   const url = useSignedUrl(visitante.foto_url, 'condominios-media')
 *   return url ? <img src={url} /> : <Placeholder />
 *
 * Returns:
 *   - the signed URL (when value is a bucket path or bucket URL)
 *   - the original value when it's an external URL (e.g. a real http link)
 *   - null while loading / when value is empty
 */
export function useSignedUrl(
  value: string | null | undefined,
  bucket: string,
  ttl = DEFAULT_TTL,
): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }

    if (!value) { setUrl(null); return }

    const path = extractBucketPath(value, bucket)
    if (!path) {
      // External URL — pass through, no signing needed.
      setUrl(value)
      return
    }

    async function sign() {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path!, ttl)
      if (cancelled) return
      if (error || !data?.signedUrl) {
        // Fall back to the legacy publicUrl so the image still loads while
        // the bucket is still public. Once the bucket goes private this
        // fallback will 403 and the caller sees an empty image — but the
        // hook itself stays simple.
        const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path!)
        setUrl(pub?.publicUrl ?? null)
        return
      }
      setUrl(data.signedUrl)
      const refreshIn = Math.max(ttl * 1000 - REFRESH_LEAD_MS, 30_000)
      timerRef.current = setTimeout(() => { void sign() }, refreshIn)
    }

    void sign()
    return () => {
      cancelled = true
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    }
  }, [value, bucket, ttl])

  return url
}

/**
 * Hook variant that takes an array and returns an array of signed URLs
 * (parallel to the input, same length). `null` for empty slots.
 */
export function useSignedUrls(
  values: (string | null | undefined)[] | null | undefined,
  bucket: string,
  ttl = DEFAULT_TTL,
): (string | null)[] {
  const [urls, setUrls] = useState<(string | null)[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Serialize the input so the dependency list is stable.
  const key = (values ?? []).join('|')

  useEffect(() => {
    let cancelled = false
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }

    const list = values ?? []
    if (list.length === 0) { setUrls([]); return }

    async function signAll() {
      const result = await Promise.all(list.map(async (v) => {
        if (!v) return null
        const path = extractBucketPath(v, bucket)
        if (!path) return v
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttl)
        if (error || !data?.signedUrl) {
          const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path)
          return pub?.publicUrl ?? null
        }
        return data.signedUrl
      }))
      if (cancelled) return
      setUrls(result)
      const refreshIn = Math.max(ttl * 1000 - REFRESH_LEAD_MS, 30_000)
      timerRef.current = setTimeout(() => { void signAll() }, refreshIn)
    }

    void signAll()
    return () => {
      cancelled = true
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, bucket, ttl])

  return urls
}
