import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encryptSecret, decryptSecret } from '../_shared/secretsCrypto.ts'
import { timingSafeEqualSecret } from '../_shared/auth.ts'
import { assertEmailAddress } from '../_shared/emailHeaders.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? 'https://administratodo.com'

// WhatsApp (opcional). Si no hay credenciales el canal se omite silenciosamente.
// Proveedores soportados: 'meta' (WhatsApp Cloud API) o 'twilio'.
const WHATSAPP_PROVIDER = (Deno.env.get('WHATSAPP_PROVIDER') ?? '').toLowerCase()
const WA_META_TOKEN = Deno.env.get('WHATSAPP_TOKEN') ?? ''
const WA_META_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID') ?? ''
const WA_META_TEMPLATE = Deno.env.get('WHATSAPP_TEMPLATE') ?? ''
const WA_META_LANG = Deno.env.get('WHATSAPP_TEMPLATE_LANG') ?? 'es'
const TWILIO_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? ''
const TWILIO_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? ''
const TWILIO_FROM = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? ''

// CORS con validación de origen (mismo enfoque que route-reminders / send-email).
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
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  }
}

// deno-lint-ignore no-explicit-any
type Client = ReturnType<typeof createClient>
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>

// ---------------------------------------------------------------------------
// Gmail helpers (mismo enfoque que la función send-email / route-reminders)
// ---------------------------------------------------------------------------

interface EmailConfig {
  id: string
  email: string
  access_token: string
  refresh_token: string | null
  token_expiry: string | null
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
    .update({ access_token: await encryptSecret(data.access_token), token_expiry: newExpiry })
    .eq('id', configId)
  return data.access_token
}

function buildRawMessage(from: string, to: string, subject: string, htmlBody: string): string {
  // PR-15: el destinatario se VALIDA antes de entrar en la cabecera. `To` es la
  // única cabecera de este mensaje que no va codificada en base64, así que es la
  // única por la que se puede inyectar (`\r\nBcc: ...`). Lanza en vez de sanear:
  // recortar los CRLF en silencio enviaría a un destinatario distinto del pedido.
  const safeTo = assertEmailAddress('To', to)
  const boundary = `----=_Part_${Date.now()}`
  const lines = [
    `From: ${from}`,
    `To: ${safeTo}`,
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
  const raw = buildRawMessage(config.email, to, subject, htmlBody)
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(`Gmail API: ${JSON.stringify(err)}`)
  }
}

function applyVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '')
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

function baseLayout(content: string, empresa: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(empresa)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;"><tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:600px;">
    <tr><td style="background:linear-gradient(135deg,#0ea5e9,#0d9488);padding:28px 32px;text-align:center;">
      <span style="color:#fff;font-size:22px;font-weight:700;">${escapeHtml(empresa)}</span></td></tr>
    <tr><td style="padding:32px;">${content}</td></tr>
    <tr><td style="background:#f8fafc;padding:18px 32px;text-align:center;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:12px;color:#94a3b8;">Aviso automático de ${escapeHtml(empresa)}. Por favor no responda directamente.</p></td></tr>
  </table>
</td></tr></table></body></html>`
}

function renderPaquete(vars: Record<string, string>): { subject: string; html: string } {
  const empresa = vars.empresa_nombre || 'AdministraTodo'
  const content = `
    <h2 style="margin:0 0 4px;color:#0f172a;font-size:20px;">📦 ${escapeHtml(vars.tipo_label)} en portería</h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Hola <strong>${escapeHtml(vars.to_name || '')}</strong>, recibimos un envío para tu unidad y está disponible para que lo retires.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:24px;">
      <tr style="background:#0d9488;"><td colspan="2" style="padding:12px 18px;color:#fff;font-weight:700;font-size:13px;">DETALLE DEL ENVÍO</td></tr>
      <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Unidad</td><td style="padding:10px 18px;font-size:14px;color:#0f172a;font-weight:700;text-align:right;border-bottom:1px solid #e2e8f0;">${escapeHtml(vars.unidad || '—')}</td></tr>
      <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Descripción</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;text-align:right;border-bottom:1px solid #e2e8f0;">${escapeHtml(vars.descripcion || '—')}</td></tr>
      ${vars.remitente ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Remitente</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;text-align:right;border-bottom:1px solid #e2e8f0;">${escapeHtml(vars.remitente)}</td></tr>` : ''}
      ${vars.empresa_mensajeria ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;">Mensajería</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;text-align:right;">${escapeHtml(vars.empresa_mensajeria)}</td></tr>` : ''}
    </table>
    <div style="text-align:center;margin:28px 0;"><a href="${vars.app_url || APP_URL}" style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#0d9488);color:#fff;text-decoration:none;padding:13px 32px;border-radius:10px;font-size:15px;font-weight:700;">Ver y firmar recepción</a></div>
    <p style="margin:0;font-size:13px;color:#64748b;">Al retirarlo podrás firmar la recepción desde tu portal.</p>`
  return {
    subject: `📦 ${vars.tipo_label} disponible en portería · ${vars.unidad || ''}`.trim(),
    html: baseLayout(content, empresa),
  }
}

// ---------------------------------------------------------------------------
// WhatsApp (abstracción de proveedor; no-op si no está configurado)
// ---------------------------------------------------------------------------

function digits(phone: string): string { return phone.replace(/[^\d]/g, '') }

async function sendWhatsAppMeta(to: string, vars: Record<string, string>): Promise<void> {
  const url = `https://graph.facebook.com/v19.0/${WA_META_PHONE_ID}/messages`
  // Mensaje iniciado por la empresa => requiere plantilla aprobada.
  const body = {
    messaging_product: 'whatsapp',
    to: digits(to),
    type: 'template',
    template: {
      name: WA_META_TEMPLATE,
      language: { code: WA_META_LANG },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: vars.unidad },
          { type: 'text', text: vars.descripcion },
        ],
      }],
    },
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_META_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Meta WhatsApp: ${await res.text()}`)
}

async function sendWhatsAppTwilio(to: string, vars: Record<string, string>): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`
  const toFmt = `whatsapp:+${digits(to)}`
  const params = new URLSearchParams({
    From: TWILIO_FROM,
    To: toFmt,
    Body: `📦 Tienes ${vars.tipo_label} en portería para ${vars.unidad}: ${vars.descripcion}. Pasa a recogerlo cuando gustes.`,
  })
  const auth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  if (!res.ok) throw new Error(`Twilio WhatsApp: ${await res.text()}`)
}

async function sendWhatsApp(to: string | null, vars: Record<string, string>): Promise<'sent' | 'not_configured' | 'error'> {
  if (!to) return 'not_configured'
  try {
    if (WHATSAPP_PROVIDER === 'meta' && WA_META_TOKEN && WA_META_PHONE_ID && WA_META_TEMPLATE) {
      await sendWhatsAppMeta(to, vars); return 'sent'
    }
    if (WHATSAPP_PROVIDER === 'twilio' && TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM) {
      await sendWhatsAppTwilio(to, vars); return 'sent'
    }
    return 'not_configured'
  } catch (err) {
    console.error('[notify-package] whatsapp failed', String(err))
    return 'error'
  }
}

const TIPO_LABEL: Record<string, string> = {
  paquete: 'Paquete', documento: 'Documento', sobre: 'Sobre', otro: 'Envío',
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

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim()

    // ── Auth: interno (service key) o usuario de la empresa (JWT) ──
    let internal = false
    let callerIsSuperAdmin = false
    let callerCompanyId: string | null = null

    if (token && await timingSafeEqualSecret(token, SERVICE_ROLE_KEY)) {
      internal = true
    } else if (token) {
      const { data: { user }, error } = await admin.auth.getUser(token)
      if (error || !user) return json({ error: 'Unauthorized' }, 401)
      const { data: au } = await admin.from('app_users').select('company_id, role').eq('id', user.id).maybeSingle()
      if (!au) return json({ error: 'Forbidden' }, 403)
      if (au.role === 'super_admin') callerIsSuperAdmin = true
      else callerCompanyId = au.company_id as string
    } else {
      return json({ error: 'Unauthorized' }, 401)
    }

    const body = await req.json().catch(() => ({})) as { paquete_id?: string }
    if (!body.paquete_id) return json({ error: 'paquete_id requerido' }, 400)

    // ── Cargar el paquete + unidad + empresa ──
    const { data: pkg } = await admin
      .from('paquetes_recibidos')
      .select('*, unidades(nombre, cliente_id), companies(nombre)')
      .eq('id', body.paquete_id)
      .maybeSingle()
    if (!pkg) return json({ error: 'Paquete no encontrado' }, 404)

    // Autorización por empresa para el camino con JWT.
    if (!internal && !callerIsSuperAdmin && (pkg as Row).company_id !== callerCompanyId) {
      return json({ error: 'Forbidden' }, 403)
    }

    // Idempotencia: si ya se notificó, no reenviar.
    if ((pkg as Row).notificado_at) return json({ success: true, skipped: 'already_notified' })

    const unidad = (pkg as Row).unidades as Row | null
    const clienteId: string | null = unidad?.cliente_id ?? null
    const unidadNombre: string = unidad?.nombre ?? ''
    const empresaNombre: string = ((pkg as Row).companies as Row | null)?.nombre ?? 'AdministraTodo'
    const tipoLabel = TIPO_LABEL[(pkg as Row).tipo as string] ?? 'Envío'

    if (!clienteId) return json({ success: true, skipped: 'no_cliente' })

    // Contacto del residente (clientes) + usuarios de app vinculados.
    const { data: cliente } = await admin
      .from('clientes')
      .select('nombre, email, telefono, whatsapp')
      .eq('id', clienteId)
      .maybeSingle()
    const { data: appUsers } = await admin
      .from('app_users')
      .select('id')
      .eq('cliente_id', clienteId)
      .eq('activo', true)

    const vars: Record<string, string> = {
      to_name: (cliente as Row)?.nombre ?? '',
      unidad: unidadNombre,
      descripcion: (pkg as Row).descripcion ?? '',
      remitente: (pkg as Row).remitente ?? '',
      empresa_mensajeria: (pkg as Row).empresa_mensajeria ?? '',
      empresa_nombre: empresaNombre,
      tipo_label: tipoLabel,
      app_url: APP_URL,
    }

    let notified = 0
    let emailed = 0
    let whatsapp: 'sent' | 'not_configured' | 'error' = 'not_configured'

    // ── In-app ──
    const rows = (appUsers ?? []).map((u: Row) => ({
      user_id: u.id,
      company_id: (pkg as Row).company_id,
      tipo: 'paquete_pendiente',
      titulo: `📦 ${tipoLabel} en portería`,
      cuerpo: `${vars.descripcion}${vars.remitente ? ` · De: ${vars.remitente}` : ''} para ${unidadNombre}. Pasa a recogerlo cuando gustes.`,
      seccion: 'paquetes',
      paquete_id: (pkg as Row).id,
    }))
    if (rows.length > 0) {
      const { error } = await admin.from('user_notifications').insert(rows)
      if (error) console.error('[notify-package] in-app insert failed', error.message)
      else notified = rows.length
    }

    // ── Email ──
    const email = (cliente as Row)?.email as string | null
    if (email) {
      const { data: cfg } = await admin
        .from('company_email_configs')
        .select('id, email, access_token, refresh_token, token_expiry')
        .eq('company_id', (pkg as Row).company_id)
        .eq('is_active', true)
        .maybeSingle()
      if (cfg) {
        // P0 #7: descifrar los tokens en reposo (dual-read).
        const cs = cfg as { access_token?: string | null; refresh_token?: string | null }
        cs.access_token = (await decryptSecret(cs.access_token)) ?? ''
        cs.refresh_token = await decryptSecret(cs.refresh_token)
        const { data: customTpl } = await admin
          .from('email_templates')
          .select('subject, html_body')
          .eq('template_key', 'paquete_recibido')
          .eq('is_active', true)
          .eq('company_id', (pkg as Row).company_id)
          .maybeSingle()
        const rendered = customTpl
          ? { subject: applyVars((customTpl as Row).subject as string, vars), html: applyVars((customTpl as Row).html_body as string, vars) }
          : renderPaquete(vars)
        try {
          await sendViaGmail(cfg as unknown as EmailConfig, email, rendered.subject, rendered.html, admin)
          emailed = 1
        } catch (err) {
          console.error('[notify-package] email failed', String(err))
        }
      }
    }

    // ── WhatsApp (opcional) ──
    const waTo = ((cliente as Row)?.whatsapp as string | null) || ((cliente as Row)?.telefono as string | null) || null
    whatsapp = await sendWhatsApp(waTo, vars)

    // Marca de notificado (idempotencia).
    await admin.from('paquetes_recibidos')
      .update({ notificado_at: new Date().toISOString() })
      .eq('id', (pkg as Row).id)

    return json({ success: true, notified, emailed, whatsapp })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
