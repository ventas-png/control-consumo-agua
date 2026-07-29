import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encryptSecret, decryptSecret } from '../_shared/secretsCrypto.ts'
import { isRetriable } from '../_shared/emailRetryable.ts'
import { timingSafeEqualSecret } from '../_shared/auth.ts'

// process-email-queue: worker que process el batch de emails pendientes.
// Disparado por pg_cron cada 5 minutos. Toma hasta 50 rows pendientes,
// los reintenta, y reporta el resultado via update_email_attempt.
//
// Auth: requiere CRON_SECRET en el header. Cron lo manda via pg_net. No
// se llama desde frontend.
//
// Importante: este endpoint hace HTTP a Gmail API para cada row. Si Gmail
// responde con error transitorio (429), update_email_attempt lo re-enqueea
// con backoff exponencial. Si responde con error permanente (401), tambien
// se reintenta hasta agotar max_attempts (default 6) — los workers no
// clasifican retriable/permanent porque el operador puede haber reparado
// el token entre intentos.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''

interface QueueRow {
  id: number
  payload: {
    company_id?: string | null
    is_superadmin?: boolean
    template_key: string
    to_email: string
    to_name?: string
    vars: Record<string, string>
  }
  company_id: string | null
  is_superadmin: boolean
  triggered_by: string | null
  attempts: number
  max_attempts: number
}

interface EmailConfig {
  id: string
  email: string
  access_token: string
  refresh_token: string | null
  token_expiry: string | null
  from_name: string | null
  reply_to: string | null
}

async function refreshAccessToken(
  refreshToken: string,
  supabase: ReturnType<typeof createClient>,
  configId: string,
): Promise<string | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json() as { access_token?: string }
  if (!data.access_token) return null
  const newExpiry = new Date(Date.now() + 3600 * 1000).toISOString()
  await supabase.from('company_email_configs')
    .update({ access_token: await encryptSecret(data.access_token), token_expiry: newExpiry })
    .eq('id', configId)
  return data.access_token
}

// Reusable: el frontend llamada send-email replica esta logica. Cuando se haga
// el siguiente refactor, mover a shared/. Por ahora duplicado para evitar
// scope creep.
async function attemptSend(
  row: QueueRow,
  supabase: ReturnType<typeof createClient>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { payload } = row
  if (!payload.template_key || !payload.to_email) {
    return { ok: false, error: 'payload invalido (template_key/to_email)' }
  }

  // Fetch email config segun is_superadmin.
  const cfgQuery = row.is_superadmin
    ? supabase.from('company_email_configs')
        .select('id, email, access_token, refresh_token, token_expiry, from_name, reply_to')
        .eq('is_active', true).eq('is_superadmin', true)
    : supabase.from('company_email_configs')
        .select('id, email, access_token, refresh_token, token_expiry, from_name, reply_to')
        .eq('is_active', true).eq('company_id', row.company_id ?? '')
  const { data: cfgData } = await cfgQuery.maybeSingle()
  if (!cfgData) return { ok: false, error: 'sin Gmail config activa' }

  const config = cfgData as EmailConfig
  // P0 #7: descifrar los tokens en reposo (dual-read: texto plano legacy pasa igual).
  config.access_token = (await decryptSecret(config.access_token)) ?? ''
  config.refresh_token = await decryptSecret(config.refresh_token)
  let accessToken = config.access_token
  const isExpired = config.token_expiry != null &&
    new Date(config.token_expiry).getTime() - Date.now() < 5 * 60 * 1000
  if (isExpired && config.refresh_token) {
    const fresh = await refreshAccessToken(config.refresh_token, supabase, config.id)
    if (fresh) accessToken = fresh
  }

  // Build & send: el worker no re-renderea templates. send-email ya valido
  // el template_key originalmente; el payload guarda los vars como vinieron.
  // Llamamos al endpoint send-email recursivamente seria un anti-pattern
  // (auth, CORS, etc). Aqui hacemos el build minimo inline.
  //
  // El template HTML completo se construye solo desde 'subject' y 'vars'.
  // Para no duplicar todos los templates, este worker delega a la misma
  // funcion send-email via internal HTTP. Mas simple que mantener 2 copias.
  const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      // Marca interna: send-email puede saltarse el auth.getUser si ve este
      // header con secret valido y triggered_by valido.
      'x-internal-retry': CRON_SECRET,
      'x-triggered-by': row.triggered_by ?? '',
    },
    body: JSON.stringify(payload),
  })

  if (sendRes.ok) {
    // Si send-email devuelve queued (nuevo retry enqueueado), tratamos el
    // intento actual como exitoso (delegamos al nuevo enqueue). No deberia
    // pasar normalmente — el envio interno saltea isRetriable.
    return { ok: true }
  }

  const errText = await sendRes.text().catch(() => `HTTP ${sendRes.status}`)
  // Log para diagnostico en supabase logs.
  console.error(`[process-email-queue] send fallo row ${row.id}: ${errText.slice(0, 200)}`)
  // El clasificador no se usa para abortar — siempre dejamos que el cron
  // siga reintentando hasta max_attempts. La excepcion: 401 token revoked
  // donde el config esta roto y el retry no va a ayudar. Si isRetriable
  // devuelve false el RPC update_email_attempt igualmente backoffea.
  void isRetriable
  return { ok: false, error: errText.slice(0, 1000) }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Auth: solo el cron (con CRON_SECRET) puede invocar.
  // Comparación en tiempo constante (auditoría 2026-07-28, Bloque B · PR-11):
  // un `!==` de strings sale en el primer byte distinto, así que su duración
  // filtra cuántos bytes iniciales acertaste. Importa especialmente aquí porque
  // este worker reenvía el MISMO CRON_SECRET a send-email como `x-internal-retry`
  // (línea ~126), que es la ruta que se salta toda la autorización.
  const auth = req.headers.get('x-cron-secret') ?? ''
  if (!CRON_SECRET || !(await timingSafeEqualSecret(auth, CRON_SECRET))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Pop batch atomico (FOR UPDATE SKIP LOCKED).
  const { data: rows, error: popErr } = await supabase.rpc('pop_email_batch', { p_batch_size: 50 })
  if (popErr) {
    return new Response(JSON.stringify({ error: popErr.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  const queueRows = (rows ?? []) as QueueRow[]
  if (queueRows.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Procesa en paralelo limitado a 5 — Gmail rate-limits agresivamente.
  let succeeded = 0
  let failed = 0
  const CHUNK = 5
  for (let i = 0; i < queueRows.length; i += CHUNK) {
    const chunk = queueRows.slice(i, i + CHUNK)
    await Promise.all(chunk.map(async row => {
      const result = await attemptSend(row, supabase)
      if (result.ok) {
        succeeded++
        await supabase.rpc('update_email_attempt', { p_id: row.id, p_ok: true, p_error: null })
      } else {
        failed++
        await supabase.rpc('update_email_attempt', { p_id: row.id, p_ok: false, p_error: result.error })
      }
    }))
  }

  return new Response(JSON.stringify({
    processed: queueRows.length,
    succeeded,
    failed,
  }), { headers: { 'Content-Type': 'application/json' } })
})
