// send-push — Fase 3 (app móvil): despacha notificaciones push a los dispositivos
// de un usuario vía Firebase Cloud Messaging HTTP v1 (FCM enruta a APNs para iOS
// si subes tu clave APNs a Firebase, así un solo canal cubre Android e iOS).
//
// ESTADO: listo pero requiere configuración (ver MOBILE.md):
//   - Secret FCM_SERVICE_ACCOUNT = JSON de la cuenta de servicio de Firebase.
//   - Migración 20260702000000_create_device_tokens.sql aplicada.
// Sin FCM_SERVICE_ACCOUNT la función responde { status: 'not_configured' } y no
// falla, para poder desplegarla antes de terminar el alta en Firebase/Apple.
//
// Uso: llamar desde el backend (service-role) al crear una notificación in-app,
// p. ej. tras insertar en user_notifications, con { user_id, title, body }.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const FCM_SERVICE_ACCOUNT = Deno.env.get('FCM_SERVICE_ACCOUNT') ?? ''

interface ServiceAccount {
  client_email: string
  private_key: string
  project_id: string
}

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const bin = atob(body)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

// Cachea el access token de FCM entre invocaciones calientes de la función.
let cachedToken: { token: string; exp: number } | null = null

async function getFcmAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))
  const signingInput = `${header}.${claims}`

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput))
  const jwt = `${signingInput}.${base64url(sig)}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  const data = await res.json() as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new Error('FCM token exchange failed')
  cachedToken = { token: data.access_token, exp: now + (data.expires_in ?? 3600) }
  return data.access_token
}

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req.headers.get('origin'))
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Auth: interno (service-role) o usuario autenticado enviándose a sí mismo.
  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim()
  let callerId: string | null = null
  const internal = token === SERVICE_ROLE_KEY && token.length > 0
  if (!internal) {
    if (!token) return json({ error: 'Unauthorized' }, 401)
    const { data: { user }, error } = await admin.auth.getUser(token)
    if (error || !user) return json({ error: 'Unauthorized' }, 401)
    callerId = user.id
  }

  const payload = await req.json().catch(() => ({})) as {
    user_id?: string; title?: string; body?: string; data?: Record<string, string>
  }
  const targetUserId = payload.user_id ?? callerId
  if (!targetUserId || !payload.title) return json({ error: 'user_id y title requeridos' }, 400)
  // Un usuario no-interno solo puede notificarse a sí mismo.
  if (!internal && targetUserId !== callerId) return json({ error: 'Forbidden' }, 403)

  if (!FCM_SERVICE_ACCOUNT) return json({ status: 'not_configured' })

  const { data: tokens } = await admin
    .from('device_tokens')
    .select('token')
    .eq('user_id', targetUserId)
  if (!tokens || tokens.length === 0) return json({ status: 'no_devices', sent: 0 })

  let sa: ServiceAccount
  try {
    sa = JSON.parse(FCM_SERVICE_ACCOUNT) as ServiceAccount
  } catch {
    return json({ error: 'FCM_SERVICE_ACCOUNT inválido' }, 500)
  }

  const accessToken = await getFcmAccessToken(sa)
  const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`

  let sent = 0
  const stale: string[] = []
  for (const row of tokens as { token: string }[]) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: row.token,
          notification: { title: payload.title, body: payload.body ?? '' },
          data: payload.data ?? {},
        },
      }),
    })
    if (res.ok) sent++
    else if (res.status === 404 || res.status === 400) stale.push(row.token) // token muerto
  }

  // Limpieza de tokens inválidos para no reintentarlos indefinidamente.
  if (stale.length > 0) await admin.from('device_tokens').delete().in('token', stale)

  return json({ status: 'ok', sent, cleaned: stale.length })
})
