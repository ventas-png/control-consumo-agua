import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encryptSecret, decryptSecret } from '../_shared/secretsCrypto.ts'
import { isRetriable } from '../_shared/emailRetryable.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { timingSafeEqualSecret } from '../_shared/auth.ts'
import { assertEmailAddress } from '../_shared/emailHeaders.ts'
import { enforceRateLimits, getClientIp } from '../_shared/rateLimit.ts'
import {
  applyVars,
  buildRawMessage,
  isTokenExpired,
  renderTemplate,
  resolveEmailScope,
  sanitizeVars,
} from './logic.ts'

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmailPayload {
  company_id?: string | null
  is_superadmin?: boolean
  template_key: string
  to_email: string
  to_name?: string
  vars: Record<string, string>
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

interface TokenRefreshResponse {
  access_token?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

async function refreshAccessToken(
  refreshToken: string,
  supabase: ReturnType<typeof createClient>,
  configId: string
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
  const data = await res.json() as TokenRefreshResponse
  if (!data.access_token) return null
  const newExpiry = new Date(Date.now() + 3600 * 1000).toISOString()
  await supabase
    .from('company_email_configs')
    .update({ access_token: await encryptSecret(data.access_token), token_expiry: newExpiry })
    .eq('id', configId)
  return data.access_token
}

// ---------------------------------------------------------------------------
// Gmail API send
// ---------------------------------------------------------------------------

async function sendViaGmail(
  config: EmailConfig,
  to: string,
  subject: string,
  htmlBody: string,
  supabase: ReturnType<typeof createClient>
): Promise<string | null> {
  let accessToken = config.access_token
  const isExpired = isTokenExpired(config.token_expiry)
  if (isExpired && config.refresh_token) {
    const newToken = await refreshAccessToken(config.refresh_token, supabase, config.id)
    if (newToken) accessToken = newToken
  }
  const raw = buildRawMessage(config.email, config.from_name, config.reply_to, to, subject, htmlBody)
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(`Gmail API: ${JSON.stringify(err)}`)
  }
  // messages.send devuelve { id, threadId, ... }: el id correlaciona el envío
  // con futuros eventos de entrega/bounce (com:N4). Best-effort si no parsea.
  const data = await res.json().catch(() => ({})) as { id?: string }
  return data.id ?? null
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    // Auth: dos paths.
    //   (A) Llamada normal del frontend con Bearer del usuario logueado.
    //   (B) Reintento interno desde process-email-queue: header
    //       x-internal-retry con CRON_SECRET valido + x-triggered-by con el
    //       userId original. Skip auth.getUser (que rechazaria el
    //       service_role token).
    // Auditoría 2026-07-28 (Bloque B · PR-11). Dos cambios sobre lo que había:
    //
    //   1. La comparación era `===` sobre el header. Un `===` de strings sale
    //      en cuanto encuentra el primer byte distinto, así que su duración
    //      filtra cuántos bytes iniciales acertaste: se puede recuperar el
    //      secreto byte a byte. El repo ya documenta este ataque en
    //      `_shared/auth.ts:147-152` y expone el comparador correcto — que
    //      otras funciones ya usan, pero ésta no.
    //
    //   2. Ahora se exigen LOS DOS secretos, no uno. Esta ruta se salta TODA la
    //      autorización (ver el bloque `if (!internalRetry)` más abajo), así que
    //      quien la abra manda correo como cualquier tenant o como el superadmin.
    //      Antes bastaba `CRON_SECRET`, que además está COMPARTIDO por 5
    //      funciones — filtrarlo en cualquiera de ellas abría el relay aquí.
    //      Añadir el service-role key no amplía la superficie: quien lo tenga ya
    //      tiene acceso total a la base. `process-email-queue:123` ya lo manda.
    const cronSecret = Deno.env.get('CRON_SECRET') ?? ''
    const internalHeader = req.headers.get('x-internal-retry') ?? ''
    const bearerToken = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    const internalRetry =
      cronSecret.length > 0 &&
      SUPABASE_SERVICE_ROLE_KEY.length > 0 &&
      (await timingSafeEqualSecret(internalHeader, cronSecret)) &&
      (await timingSafeEqualSecret(bearerToken, SUPABASE_SERVICE_ROLE_KEY))
    let userId: string

    if (internalRetry) {
      const tb = req.headers.get('x-triggered-by') ?? ''
      if (!tb) {
        return new Response(
          JSON.stringify({ error: 'Internal retry missing x-triggered-by' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      userId = tb
    } else {
      const authHeader = req.headers.get('authorization') ?? ''
      const token = authHeader.replace('Bearer ', '')
      const { data: { user }, error: authError } = await supabase.auth.getUser(token)
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      userId = user.id
    }

    const payload = await req.json() as EmailPayload
    const { company_id, is_superadmin, template_key, to_email, to_name, vars } = payload

    if (!template_key || !to_email) {
      return new Response(
        JSON.stringify({ error: 'template_key and to_email are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!is_superadmin && !company_id) {
      return new Response(
        JSON.stringify({ error: 'company_id or is_superadmin required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── Authorization: el "scope" del envío (qué cuenta de Gmail manda — la de
    // un tenant o la del superadmin de plataforma) se ata al rol/empresa REAL
    // del caller leído de app_users; NUNCA se confía en company_id/is_superadmin
    // del body. Sin esto, cualquier usuario autenticado (incl. un residente)
    // podría enviar correo como cualquier empresa o como el superadmin
    // (open relay / suplantación). Los reintentos internos (process-email-queue)
    // ya fueron autorizados al encolar, así que conservan el scope del payload.
    const effIsSuperadmin = !!is_superadmin
    let effCompanyId: string | null = company_id ?? null

    if (!internalRetry) {
      const { data: prof } = await supabase
        .from('app_users').select('role, company_id').eq('id', userId).maybeSingle()
      const role = (prof as { role?: string } | null)?.role ?? ''
      const callerCompany = (prof as { company_id?: string | null } | null)?.company_id ?? null

      // Decisión pura en logic.ts (testeable): misma cascada de siempre.
      const scope = resolveEmailScope(
        { isSuperadmin: effIsSuperadmin, companyId: effCompanyId },
        { role, companyId: callerCompany },
      )
      if (!scope.ok) {
        return new Response(
          JSON.stringify({ error: scope.error }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      effCompanyId = scope.companyId
    }

    // Fetch Gmail config — Supabase query builder is immutable so we apply the
    // ownership filter in a ternary to ensure it's always chained properly.
    const { data: config } = await (
      effIsSuperadmin
        ? supabase.from('company_email_configs')
            .select('id, email, access_token, refresh_token, token_expiry, from_name, reply_to')
            .eq('is_active', true)
            .eq('is_superadmin', true)
        : supabase.from('company_email_configs')
            .select('id, email, access_token, refresh_token, token_expiry, from_name, reply_to')
            .eq('is_active', true)
            .eq('company_id', effCompanyId!)
    ).maybeSingle()

    if (!config) {
      return new Response(
        JSON.stringify({ error: 'No hay cuenta de Gmail conectada para esta empresa' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // El ASUNTO es texto plano (header MIME) y el CUERPO es HTML. Usamos vars
    // crudas para el asunto (para no mostrar entidades como &amp;) y vars
    // escapadas para el cuerpo (anti HTML/enlaces inyectados + validación de URL).
    const rawVars: Record<string, string> = { to_name: to_name ?? '', ...vars }
    const htmlVars = sanitizeVars(rawVars)

    // Check for custom template override in DB (immutable builder — use ternary)
    const { data: customTpl } = await (
      effIsSuperadmin
        ? supabase.from('email_templates')
            .select('subject, html_body')
            .eq('template_key', template_key)
            .eq('is_active', true)
            .eq('is_superadmin', true)
        : supabase.from('email_templates')
            .select('subject, html_body')
            .eq('template_key', template_key)
            .eq('is_active', true)
            .eq('company_id', effCompanyId!)
    ).maybeSingle()

    let subject: string
    let htmlBody: string

    if (customTpl) {
      subject = applyVars(customTpl.subject, rawVars)
      htmlBody = applyVars(customTpl.html_body, htmlVars)
    } else {
      const renderedRaw = renderTemplate(template_key, rawVars)
      const renderedHtml = renderTemplate(template_key, htmlVars)
      if (!renderedRaw || !renderedHtml) {
        return new Response(
          JSON.stringify({ error: `Template desconocido: ${template_key}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      subject = renderedRaw.subject
      htmlBody = renderedHtml.html
    }

    // Send + log. Log writes con service_role (bypassea RLS); fire-and-forget
    // si el log mismo falla — no queremos que un error de bitacora bloquee la
    // entrega del correo en si.
    //
    // Nueva politica (F2.15e): si el envio sincrono falla con error retriable
    // (429, 5xx, network) enqueueamos en email_send_queue y respondemos
    // success=true con status='queued'. El worker process-email-queue lo
    // retoma con backoff exponencial. Errores permanentes (400, 403 token
    // revoked) responden 500 — no tiene sentido reintentar.
    const typedConfig = config as EmailConfig
    // P0 #7: descifrar los tokens en reposo (dual-read: texto plano legacy pasa igual).
    typedConfig.access_token = (await decryptSecret(typedConfig.access_token)) ?? ''
    typedConfig.refresh_token = await decryptSecret(typedConfig.refresh_token)
    // El payload re-encolado para reintentos usa el scope EFECTIVO ya validado,
    // no el del body original (que pudo venir manipulado).
    const scopedPayload = { ...payload, company_id: effIsSuperadmin ? null : effCompanyId, is_superadmin: effIsSuperadmin }

    // Píxel de apertura (com:N4): tracking_id efímero firmado con CRON_SECRET;
    // track-email-open lo verifica y marca opened_at. Sin secreto configurado
    // no se inyecta nada (degradación graceful, el correo sale igual).
    let trackingId: string | null = null
    if (cronSecret) {
      trackingId = crypto.randomUUID()
      const token = await buildTrackingToken('t', trackingId, cronSecret)
      htmlBody = appendTrackingPixel(htmlBody, buildPixelUrl(SUPABASE_URL, token))
    }

    try {
      const gmailMessageId = await sendViaGmail(typedConfig, to_email, subject, htmlBody, supabase)
      supabase.from('email_send_log').insert({
        company_id: effIsSuperadmin ? null : effCompanyId,
        is_superadmin: effIsSuperadmin,
        template_key,
        to_email,
        from_email: typedConfig.email,
        status: 'sent',
        triggered_by: userId,
        gmail_message_id: gmailMessageId,
        tracking_id: trackingId,
      }).then(({ error }) => { if (error) console.error('[email_send_log] insert failed:', error.message) })

      return new Response(
        JSON.stringify({ success: true, status: 'sent' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } catch (sendErr) {
      const errMsg = sendErr instanceof Error ? sendErr.message : String(sendErr)
      const retriable = isRetriable(errMsg)

      // En llamadas internalRetry NO re-enqueueamos: la queue ya tiene el
      // row, y update_email_attempt es el que decide reintentar o marcar
      // failed_permanent. Devolver el error directo al worker.
      if (retriable && !internalRetry) {
        const { data: queueRow } = await supabase.rpc('enqueue_email', {
          p_payload: scopedPayload,
          p_company_id: effIsSuperadmin ? null : effCompanyId,
          p_is_superadmin: effIsSuperadmin,
          p_triggered_by: userId,
          p_first_error: errMsg.slice(0, 1000),
        })
        supabase.from('email_send_log').insert({
          company_id: effIsSuperadmin ? null : effCompanyId,
          is_superadmin: effIsSuperadmin,
          template_key,
          to_email,
          from_email: typedConfig.email,
          status: 'pending_retry',
          error_message: errMsg.slice(0, 1000),
          triggered_by: userId,
        }).then(({ error }) => { if (error) console.error('[email_send_log] insert failed:', error.message) })

        return new Response(
          JSON.stringify({ success: true, status: 'queued', queue_id: queueRow ?? null }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      supabase.from('email_send_log').insert({
        company_id: effIsSuperadmin ? null : effCompanyId,
        is_superadmin: effIsSuperadmin,
        template_key,
        to_email,
        from_email: typedConfig.email,
        status: 'failed',
        error_message: errMsg.slice(0, 1000),
        triggered_by: userId,
      }).then(({ error }) => { if (error) console.error('[email_send_log] insert failed:', error.message) })
      throw sendErr
    }
  } catch (err) {
    // PR-17: el detalle se registra pero NO se devuelve. Antes se mandaba
    // `String(err)` al cliente, que expone texto de Postgres / de la API de
    // Google. Sin este log el detalle se perdería del todo, que es peor para
    // diagnosticar que la fuga que se está cerrando.
    console.error('[send-email]', err instanceof Error ? err.message : String(err))
    return new Response(
      JSON.stringify({ error: 'Error interno del servidor. Si persiste, contactá a soporte.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
