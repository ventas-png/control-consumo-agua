// ============================================================================
// track-email-open — píxel de apertura de correos (com:N4, épica #301)
// ============================================================================
// Endpoint PÚBLICO (verify_jwt=false): los clientes de correo cargan el <img>
// sin ningún header de auth. La autorización es el propio token firmado:
//
//   GET /track-email-open?t=<kind>:<id>:<hmac>
//
//   kind 'o' → id = notifications_outbox.id  → mark_notification_delivery(read)
//   kind 't' → id = email_send_log.tracking_id → mark_email_open
//
// El HMAC-SHA256 (firmado con CRON_SECRET al construir el correo) impide que
// un tercero marque lecturas ajenas adivinando uuids. La respuesta es SIEMPRE
// el mismo GIF 1x1 con 200 — token inválido incluido — para no filtrar señal.
// Las escrituras son idempotentes (COALESCE en los sellos) así que los proxies
// de imágenes que cargan el píxel varias veces no distorsionan más que la
// primera vez. Nota conocida: Gmail/Apple prefetchean imágenes, por lo que
// "abierto" es una cota superior — limitación estándar de píxeles de apertura.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { onePixelGifBytes, verifyTrackingToken } from '../_shared/deliveryTracking.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''

const GIF_HEADERS = {
  'Content-Type': 'image/gif',
  // Sin caché: cada apertura (o al menos cada cliente) vuelve a pegarle al
  // endpoint; la idempotencia del sello hace inocuas las repeticiones.
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
} as const

function gif(): Response {
  return new Response(onePixelGifBytes(), { status: 200, headers: GIF_HEADERS })
}

Deno.serve(async (req: Request) => {
  // Solo GET/HEAD (los clientes de correo no mandan otra cosa para un <img>).
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  try {
    const token = new URL(req.url).searchParams.get('t')
    const parsed = await verifyTrackingToken(token, CRON_SECRET)
    if (!parsed) return gif() // inválido/forjado → mismo GIF, sin efectos

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    if (parsed.kind === 'o') {
      const { error } = await admin.rpc('mark_notification_delivery', {
        p_outbox_id: parsed.id,
        p_event: 'read',
        p_detail: { via: 'pixel' },
      })
      if (error) console.error('[track-email-open] mark_notification_delivery failed', parsed.id, error.message)
    } else {
      const { error } = await admin.rpc('mark_email_open', { p_tracking_id: parsed.id })
      if (error) console.error('[track-email-open] mark_email_open failed', parsed.id, error.message)
    }
  } catch (err) {
    // Nunca romper la carga de la imagen por un error interno.
    console.error('[track-email-open]', err instanceof Error ? err.message : String(err))
  }

  return gif()
})
