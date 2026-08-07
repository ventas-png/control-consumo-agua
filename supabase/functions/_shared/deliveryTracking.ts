// ============================================================================
// deliveryTracking — helpers PUROS del tracking de entrega/lectura (com:N4/N26)
// ============================================================================
// Épica #301. Consumidos por notifications-dispatcher (píxel en emails del
// outbox), send-email (píxel en envíos directos, correlación por tracking_id)
// y track-email-open (verificación del token y respuesta GIF).
//
// El token del píxel es `${kind}:${id}:${hmac}`:
//   kind 'o' → id = notifications_outbox.id (uuid)   → marca read en el outbox
//   kind 't' → id = email_send_log.tracking_id (uuid) → marca opened_at en el log
// La firma es HMAC-SHA256(`${kind}:${id}`, secret) en hex. Sin la firma válida
// el endpoint público no toca nada (anti-forja: nadie puede marcar leídos
// ajenos adivinando uuids). El secreto es CRON_SECRET (server-side, jamás en
// el cliente; el token viaja solo dentro del HTML del correo).
//
// Sin dependencias Deno/https: usa Web Crypto (disponible en Deno y Node 18+),
// así vitest lo testea directo (patrón _shared/billingSync.ts).

export type TrackingKind = 'o' | 't'

const KINDS: readonly TrackingKind[] = ['o', 't'] as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
}

// Comparación en tiempo constante sobre los hex (mismo espíritu que
// _shared/auth.timingSafeEqualSecret): sin cortocircuito por prefijo.
function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Construye el token firmado del píxel. */
export async function buildTrackingToken(kind: TrackingKind, id: string, secret: string): Promise<string> {
  const sig = await hmacHex(`${kind}:${id}`, secret)
  return `${kind}:${id}:${sig}`
}

/**
 * Verifica un token del píxel. Devuelve { kind, id } si la firma es válida y el
 * id es un uuid; null ante cualquier otra cosa (malformado, kind desconocido,
 * firma inválida). Nunca lanza.
 */
export async function verifyTrackingToken(
  token: string | null | undefined,
  secret: string,
): Promise<{ kind: TrackingKind; id: string } | null> {
  if (!token || !secret) return null
  const parts = token.split(':')
  if (parts.length !== 3) return null
  const [kind, id, sig] = parts
  if (!KINDS.includes(kind as TrackingKind)) return null
  if (!UUID_RE.test(id)) return null
  const expected = await hmacHex(`${kind}:${id}`, secret)
  if (!constantTimeEqualHex(sig.toLowerCase(), expected)) return null
  return { kind: kind as TrackingKind, id }
}

/** URL pública del endpoint del píxel para un token dado. */
export function buildPixelUrl(supabaseUrl: string, token: string): string {
  const base = supabaseUrl.replace(/\/+$/, '')
  return `${base}/functions/v1/track-email-open?t=${encodeURIComponent(token)}`
}

/**
 * Inyecta el <img> de tracking en el HTML del correo: antes de </body> si
 * existe (case-insensitive), si no al final. Idempotente por construcción no
 * (cada llamada agrega uno) — el caller lo invoca una sola vez por mensaje.
 */
export function appendTrackingPixel(html: string, pixelUrl: string): string {
  const img = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;max-height:1px;max-width:1px;" />`
  const m = /<\/body>/i.exec(html)
  if (m) return html.slice(0, m.index) + img + html.slice(m.index)
  return html + img
}

// GIF transparente de 1x1 (42 bytes). El endpoint SIEMPRE responde esto con
// 200, válido o no el token, para no filtrar señal a un tercero que pruebe
// tokens (la única diferencia observable sería el timing del RPC).
export const ONE_PIXEL_GIF_BASE64 =
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/** Decodifica el GIF a bytes (Deno y Node comparten atob). */
export function onePixelGifBytes(): Uint8Array {
  const bin = atob(ONE_PIXEL_GIF_BASE64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
