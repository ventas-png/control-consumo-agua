// ============================================================================
// notifications-dispatcher — orquestador multi-canal (T2/com:N4)
// ============================================================================
// Epica #301 · sub-issue #315 (N4).
//
// Lee public.notifications_outbox (status='queued' AND scheduled_at<=now()) via
// el RPC atomico claim_notifications_batch (FOR UPDATE SKIP LOCKED), despacha
// cada fila segun su channel y reporta el resultado con mark_notification_result
// (sent | queued-con-backoff | failed). Idempotente y con limite de lote:
// el claim marca 'sending' antes de procesar, asi dos corridas concurrentes
// nunca toman la misma fila.
//
// Canales:
//   in_app   → INSERT en public.user_notifications (la campana existente).
//   email    → Gmail via company_email_configs (mismo enfoque que send-email /
//              route-reminders). Resuelve plantilla: notification_templates del
//              tenant → global → email_templates → render minimo del payload.
//   whatsapp → no implementado todavia (follow-up); se marca failed no-retriable.
//   push     → no implementado todavia (follow-up); se marca failed no-retriable.
//
// Auth (interno, mismo espiritu que route-reminders / process-email-queue):
//   - x-cron-secret == CRON_SECRET (el cron de pg_net manda este header), o
//   - Authorization: Bearer <SERVICE_ROLE_KEY> (invocacion manual interna).
//
// Disparo: pg_cron cada minuto via run_notifications_dispatcher() (ver
// migracion 20260604100000_notifications_outbox.sql).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? 'https://administratodo.com'

// Tamaño de lote por corrida. Acotado para no exceder el tiempo del edge fn.
const DEFAULT_BATCH = 50
const MAX_BATCH = 200

// CORS con validación de origen (mismo enfoque que _shared/cors.ts y send-email).
function getCorsHeaders(origin: string | null) {
  const allowed = new Set<string>([
    'https://administratodo.com', 'https://www.administratodo.com',
    'https://administratodo.app', 'https://www.administratodo.app',
  ])
  const envOrigins = Deno.env.get('ALLOWED_ORIGINS')
  if (envOrigins) {
    for (const o of envOrigins.split(',')) { const t = o.trim(); if (t) allowed.add(t) }
  } else {
    allowed.add('http://localhost:5173'); allowed.add('http://localhost:3000')
    allowed.add('http://127.0.0.1:5173'); allowed.add('http://127.0.0.1:3000')
  }
  const appUrl = Deno.env.get('APP_URL')
  if (appUrl) { try { allowed.add(new URL(appUrl).origin) } catch { /* ignore */ } }
  const list = [...allowed]
  const allowOrigin = origin && list.includes(origin) ? origin : list[0]
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

// deno-lint-ignore no-explicit-any
type Client = ReturnType<typeof createClient>

interface OutboxRow {
  id: string
  company_id: string | null
  channel: 'in_app' | 'email' | 'whatsapp' | 'push'
  template_key: string | null
  payload: Record<string, unknown>
  recipient: string | null
  attempts: number
  max_attempts: number
}

interface DispatchResult {
  ok: boolean
  error?: string
  retriable?: boolean
}

// ---------------------------------------------------------------------------
// Gmail helpers (mismo enfoque que send-email / route-reminders)
// ---------------------------------------------------------------------------

interface EmailConfig {
  id: string
  email: string
  access_token: string
  refresh_token: string | null
  token_expiry: string | null
  from_name: string | null
  reply_to: string | null
}

async function refreshAccessToken(refreshToken: string, supabase: Client, configId: string): Promise<string | null> {
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
    .update({ access_token: data.access_token, token_expiry: newExpiry })
    .eq('id', configId)
  return data.access_token
}

function formatFromHeader(fromEmail: string, fromName: string | null): string {
  if (!fromName) return fromEmail
  const encoded = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(fromName)))}?=`
  return `"${encoded}" <${fromEmail}>`
}

function buildRawMessage(
  fromEmail: string, fromName: string | null, replyTo: string | null,
  to: string, subject: string, htmlBody: string,
): string {
  const boundary = `----=_Part_${Date.now()}`
  const lines = [
    `From: ${formatFromHeader(fromEmail, fromName)}`,
    `To: ${to}`,
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    '',
    btoa(unescape(encodeURIComponent(htmlBody))),
    '',
    `--${boundary}--`,
  ]
  return btoa(unescape(encodeURIComponent(lines.join('\r\n'))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sendViaGmail(config: EmailConfig, to: string, subject: string, htmlBody: string, supabase: Client): Promise<void> {
  let accessToken = config.access_token
  const isExpired = config.token_expiry != null &&
    new Date(config.token_expiry).getTime() - Date.now() < 5 * 60 * 1000
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
    const status = res.status
    const err = await res.json().catch(() => ({}))
    // 4xx (excepto 429) son terminales: token revocado, request malformado, etc.
    const retriable = status === 429 || status >= 500
    const e = new Error(`Gmail API ${status}: ${JSON.stringify(err)}`) as Error & { retriable: boolean }
    e.retriable = retriable
    throw e
  }
}

// ---------------------------------------------------------------------------
// Render de plantillas
// ---------------------------------------------------------------------------

function asString(v: unknown): string {
  if (v == null) return ''
  return typeof v === 'string' ? v : String(v)
}

// Sustituye {{var}} con payload (mismo motor que send-email / route-reminders).
function applyVars(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => asString(vars[k]))
}

function emailLayout(content: string, empresa: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${empresa}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;"><tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:600px;">
    <tr><td style="background:linear-gradient(135deg,#0ea5e9,#0d9488);padding:28px 32px;text-align:center;">
      <span style="color:#fff;font-size:22px;font-weight:700;">${empresa}</span></td></tr>
    <tr><td style="padding:32px;color:#334155;font-size:14px;line-height:1.7;white-space:pre-wrap;">${content}</td></tr>
    <tr><td style="background:#f8fafc;padding:18px 32px;text-align:center;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:12px;color:#94a3b8;">Notificación automática de ${empresa}. Por favor no responda directamente.</p></td></tr>
  </table>
</td></tr></table></body></html>`
}

// Resuelve plantilla de notification_templates: primero la del tenant, luego la
// global (company_id NULL). Devuelve null si no hay ninguna activa.
async function resolveNotifTemplate(
  admin: Client, companyId: string | null, key: string, channel: string, locale = 'es',
): Promise<{ subject: string | null; body: string } | null> {
  if (companyId) {
    const { data } = await admin.from('notification_templates')
      .select('subject, body')
      .eq('company_id', companyId).eq('key', key).eq('channel', channel)
      .eq('locale', locale).eq('is_active', true)
      .maybeSingle()
    if (data) return { subject: (data.subject as string) ?? null, body: data.body as string }
  }
  const { data: global } = await admin.from('notification_templates')
    .select('subject, body')
    .is('company_id', null).eq('key', key).eq('channel', channel)
    .eq('locale', locale).eq('is_active', true)
    .maybeSingle()
  if (global) return { subject: (global.subject as string) ?? null, body: global.body as string }
  return null
}

// ---------------------------------------------------------------------------
// Despacho por canal
// ---------------------------------------------------------------------------

async function dispatchInApp(admin: Client, row: OutboxRow): Promise<DispatchResult> {
  // recipient = user_id (uuid). El payload aporta titulo/cuerpo/seccion/ids.
  const userId = row.recipient
  if (!userId) return { ok: false, error: 'in_app sin recipient (user_id)', retriable: false }

  const p = row.payload ?? {}
  // Si hay plantilla in_app, renderiza titulo (subject) y cuerpo (body).
  let titulo = asString(p.titulo)
  let cuerpo = asString(p.cuerpo)
  if (row.template_key) {
    const tpl = await resolveNotifTemplate(admin, row.company_id, row.template_key, 'in_app', asString(p.locale) || 'es')
    if (tpl) {
      if (tpl.subject) titulo = applyVars(tpl.subject, p)
      cuerpo = applyVars(tpl.body, p)
    }
  }
  if (!titulo) titulo = asString(p.titulo) || 'Notificación'

  const { error } = await admin.from('user_notifications').insert({
    user_id: userId,
    company_id: row.company_id,
    tipo: asString(p.tipo) || 'notificacion',
    titulo,
    cuerpo: cuerpo || null,
    seccion: asString(p.seccion) || null,
    ruta_id: (p.ruta_id as string) ?? null,
    ocurrencia_id: (p.ocurrencia_id as string) ?? null,
  })
  if (error) return { ok: false, error: `user_notifications insert: ${error.message}`, retriable: true }
  return { ok: true }
}

async function dispatchEmail(admin: Client, row: OutboxRow): Promise<DispatchResult> {
  const toEmail = row.recipient || asString(row.payload?.to_email)
  if (!toEmail) return { ok: false, error: 'email sin recipient (to_email)', retriable: false }
  // Email de plataforma (sin company_id) requiere config superadmin — fuera de
  // alcance de este PR; lo dejamos como follow-up.
  if (!row.company_id) return { ok: false, error: 'email sin company_id no soportado todavia', retriable: false }

  const p = row.payload ?? {}

  // Nombre de empresa para el layout / vars.
  let empresaNombre = asString(p.empresa_nombre)
  if (!empresaNombre) {
    const { data: comp } = await admin.from('companies').select('nombre').eq('id', row.company_id).maybeSingle()
    empresaNombre = (comp?.nombre as string) ?? 'AdministraTodo'
  }
  const vars: Record<string, unknown> = { empresa_nombre: empresaNombre, app_url: APP_URL, ...p }

  // Config Gmail del tenant.
  const { data: cfg } = await admin.from('company_email_configs')
    .select('id, email, access_token, refresh_token, token_expiry, from_name, reply_to')
    .eq('company_id', row.company_id).eq('is_active', true)
    .maybeSingle()
  if (!cfg) return { ok: false, error: 'sin Gmail configurado para la empresa', retriable: false }

  // Resolucion de plantilla en cascada:
  //   1) notification_templates (tenant → global) por template_key.
  //   2) email_templates (override HTML existente) por template_key.
  //   3) payload directo subject/body (o body con layout por defecto).
  let subject = asString(p.subject)
  let htmlBody = asString(p.html_body) || asString(p.body)

  const notifTpl = row.template_key
    ? await resolveNotifTemplate(admin, row.company_id, row.template_key, 'email', asString(p.locale) || 'es')
    : null
  if (notifTpl) {
    subject = applyVars(notifTpl.subject ?? subject, vars)
    htmlBody = emailLayout(applyVars(notifTpl.body, vars), empresaNombre)
  } else if (row.template_key) {
    const { data: emailTpl } = await admin.from('email_templates')
      .select('subject, html_body')
      .eq('template_key', row.template_key).eq('is_active', true)
      .eq('company_id', row.company_id)
      .maybeSingle()
    if (emailTpl) {
      subject = applyVars(emailTpl.subject as string, vars)
      htmlBody = applyVars(emailTpl.html_body as string, vars)
    }
  }

  if (!htmlBody) return { ok: false, error: 'email sin body ni plantilla resoluble', retriable: false }
  if (!subject) subject = `Notificación de ${empresaNombre}`
  // Si el body no parece HTML completo, envuelvelo en el layout estandar.
  if (!/<html|<body|<table/i.test(htmlBody)) htmlBody = emailLayout(htmlBody, empresaNombre)

  try {
    await sendViaGmail(cfg as unknown as EmailConfig, toEmail, subject, htmlBody, admin)
    return { ok: true }
  } catch (err) {
    const retriable = (err as { retriable?: boolean })?.retriable ?? true
    return { ok: false, error: err instanceof Error ? err.message : String(err), retriable }
  }
}

async function dispatchRow(admin: Client, row: OutboxRow): Promise<DispatchResult> {
  switch (row.channel) {
    case 'in_app':
      return await dispatchInApp(admin, row)
    case 'email':
      return await dispatchEmail(admin, row)
    case 'whatsapp':
      return { ok: false, error: 'canal whatsapp no implementado (follow-up)', retriable: false }
    case 'push':
      return { ok: false, error: 'canal push no implementado (follow-up)', retriable: false }
    default:
      return { ok: false, error: `canal desconocido: ${row.channel}`, retriable: false }
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // ── Auth interno: x-cron-secret == CRON_SECRET, o Bearer == SERVICE_ROLE_KEY.
  const cronSecret = req.headers.get('x-cron-secret') ?? ''
  const bearer = (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim()
  const authorized =
    (CRON_SECRET !== '' && cronSecret === CRON_SECRET) ||
    (SERVICE_ROLE_KEY !== '' && bearer === SERVICE_ROLE_KEY)
  if (!authorized) return json({ error: 'Unauthorized' }, 401)

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const body = await req.json().catch(() => ({})) as { batch_size?: number }
    const batchSize = Math.min(Math.max(Number(body.batch_size) || DEFAULT_BATCH, 1), MAX_BATCH)

    // Claim atomico del lote (marca 'sending').
    const { data: rows, error } = await admin.rpc('claim_notifications_batch', { p_batch_size: batchSize })
    if (error) return json({ error: error.message }, 500)

    const batch = (rows ?? []) as OutboxRow[]
    let sent = 0
    let failed = 0
    let requeued = 0

    for (const row of batch) {
      let result: DispatchResult
      try {
        result = await dispatchRow(admin, row)
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : String(err), retriable: true }
      }

      const { error: markErr } = await admin.rpc('mark_notification_result', {
        p_id: row.id,
        p_ok: result.ok,
        p_error: result.error ?? null,
        p_retriable: result.retriable ?? true,
      })
      if (markErr) console.error('[notifications-dispatcher] mark_notification_result failed', row.id, markErr.message)

      if (result.ok) sent++
      else if (result.retriable === false || row.attempts + 1 >= row.max_attempts) failed++
      else requeued++
    }

    return json({ success: true, processed: batch.length, sent, failed, requeued })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
