import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encryptSecret, decryptSecret } from '../_shared/secretsCrypto.ts'
import { timingSafeEqualSecret } from '../_shared/auth.ts'
import { assertEmailAddress } from '../_shared/emailHeaders.ts'
// Helpers puros (sanitización, plantilla, rows in-app, payloads/selección de
// WhatsApp) extraídos a ./logic.ts para testearlos con vitest (infra:I22 ·
// Track T8). Aquí queda solo el I/O (Gmail, WhatsApp APIs, queries).
import {
  type Row,
  applyVars,
  autorizadoParaEmpresa,
  buildMetaWaPayload,
  buildPaqueteInAppRows,
  buildTwilioWaParams,
  renderPaquete,
  resolveWhatsAppProvider,
  tipoLabel,
} from './logic.ts'

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

// ---------------------------------------------------------------------------
// WhatsApp (I/O; payloads y selección de proveedor en ./logic.ts)
// ---------------------------------------------------------------------------

async function sendWhatsAppMeta(to: string, vars: Record<string, string>): Promise<void> {
  const url = `https://graph.facebook.com/v19.0/${WA_META_PHONE_ID}/messages`
  // Mensaje iniciado por la empresa => requiere plantilla aprobada.
  const body = buildMetaWaPayload(to, vars, WA_META_TEMPLATE, WA_META_LANG)
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_META_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Meta WhatsApp: ${await res.text()}`)
}

async function sendWhatsAppTwilio(to: string, vars: Record<string, string>): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`
  const params = new URLSearchParams(buildTwilioWaParams(to, vars, TWILIO_FROM))
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
    const provider = resolveWhatsAppProvider({
      provider: WHATSAPP_PROVIDER,
      metaToken: WA_META_TOKEN,
      metaPhoneId: WA_META_PHONE_ID,
      metaTemplate: WA_META_TEMPLATE,
      twilioSid: TWILIO_SID,
      twilioToken: TWILIO_TOKEN,
      twilioFrom: TWILIO_FROM,
    })
    if (provider === 'meta') {
      await sendWhatsAppMeta(to, vars); return 'sent'
    }
    if (provider === 'twilio') {
      await sendWhatsAppTwilio(to, vars); return 'sent'
    }
    return 'not_configured'
  } catch (err) {
    console.error('[notify-package] whatsapp failed', String(err))
    return 'error'
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
    if (!autorizadoParaEmpresa({ internal, callerIsSuperAdmin, callerCompanyId }, (pkg as Row).company_id)) {
      return json({ error: 'Forbidden' }, 403)
    }

    // Idempotencia: si ya se notificó, no reenviar.
    if ((pkg as Row).notificado_at) return json({ success: true, skipped: 'already_notified' })

    const unidad = (pkg as Row).unidades as Row | null
    const clienteId: string | null = unidad?.cliente_id ?? null
    const unidadNombre: string = unidad?.nombre ?? ''
    const empresaNombre: string = ((pkg as Row).companies as Row | null)?.nombre ?? 'AdministraTodo'
    const tipo = tipoLabel((pkg as Row).tipo as string)

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
      tipo_label: tipo,
      app_url: APP_URL,
    }

    let notified = 0
    let emailed = 0
    let whatsapp: 'sent' | 'not_configured' | 'error' = 'not_configured'

    // ── In-app ──
    const rows = buildPaqueteInAppRows(
      (appUsers ?? []).map((u: Row) => u.id as string),
      vars,
      { companyId: (pkg as Row).company_id, paqueteId: (pkg as Row).id },
    )
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
          : renderPaquete(vars, APP_URL)
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
