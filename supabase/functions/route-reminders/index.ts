import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encryptSecret, decryptSecret } from '../_shared/secretsCrypto.ts'
import { timingSafeEqualSecret } from '../_shared/auth.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? 'https://administratodo.com'

// Guatemala is UTC-6 year-round (no DST), so a fixed offset is safe.
const GT_OFFSET_MS = 6 * 60 * 60 * 1000

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
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  }
}

// deno-lint-ignore no-explicit-any
type Client = ReturnType<typeof createClient>
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>

interface Recipient {
  email: string | null
  userId: string | null
  rol: 'operador' | 'administrador'
}

// ---------------------------------------------------------------------------
// Gmail helpers (mismo enfoque que la función send-email)
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
  const boundary = `----=_Part_${Date.now()}`
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
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
// Plantilla de recordatorio
// ---------------------------------------------------------------------------

function baseLayout(content: string, empresa: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${empresa}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;"><tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:600px;">
    <tr><td style="background:linear-gradient(135deg,#0ea5e9,#0d9488);padding:28px 32px;text-align:center;">
      <span style="color:#fff;font-size:22px;font-weight:700;">${empresa}</span></td></tr>
    <tr><td style="padding:32px;">${content}</td></tr>
    <tr><td style="background:#f8fafc;padding:18px 32px;text-align:center;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:12px;color:#94a3b8;">Recordatorio automático de ${empresa}. Por favor no responda directamente.</p></td></tr>
  </table>
</td></tr></table></body></html>`
}

function renderRecordatorio(vars: Record<string, string>): { subject: string; html: string } {
  const empresa = vars.empresa_nombre || 'AdministraTodo'
  const content = `
    <h2 style="margin:0 0 4px;color:#0f172a;font-size:20px;">Recordatorio de Ruta</h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Hola <strong>${vars.to_name || ''}</strong>, este es un recordatorio de una ruta de lecturas programada${vars.rol_destinatario ? ` (${vars.rol_destinatario})` : ''}.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:24px;">
      <tr style="background:#0d9488;"><td colspan="2" style="padding:12px 18px;color:#fff;font-weight:700;font-size:13px;">DETALLES DE LA RUTA</td></tr>
      <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Nombre</td><td style="padding:10px 18px;font-size:14px;color:#0f172a;font-weight:700;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.ruta_nombre || '—'}</td></tr>
      ${vars.ruta_descripcion ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Descripción</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.ruta_descripcion}</td></tr>` : ''}
      <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Fecha</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.fecha_ocurrencia || '—'}${vars.hora_ocurrencia ? ` · ${vars.hora_ocurrencia}` : ''}</td></tr>
      <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;">Por leer</td><td style="padding:10px 18px;font-size:14px;color:#0d9488;font-weight:700;text-align:right;">${vars.total_items || '0'} ${vars.tipo_items || ''}</td></tr>
    </table>
    <div style="text-align:center;margin:28px 0;"><a href="${vars.app_url || APP_URL}" style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#0d9488);color:#fff;text-decoration:none;padding:13px 32px;border-radius:10px;font-size:15px;font-weight:700;">Abrir AdministraTodo</a></div>
    <p style="margin:0;font-size:13px;color:#64748b;">Por favor asegúrate de completarla en la fecha indicada.</p>`
  return {
    subject: `Recordatorio de ruta: ${vars.ruta_nombre || 'Ruta'} | ${empresa}`,
    html: baseLayout(content, empresa),
  }
}

function applyVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '')
}

// ---------------------------------------------------------------------------
// Helpers de dominio
// ---------------------------------------------------------------------------

function todayGT(): string {
  return new Date(Date.now() - GT_OFFSET_MS).toISOString().slice(0, 10)
}

function fmtFecha(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function hhmm(t: string | null | undefined): string {
  return t ? String(t).slice(0, 5) : ''
}

function isDue(occ: Row, route: Row): boolean {
  const hora = hhmm(occ.hora) || hhmm(route.hora_programada) || '08:00'
  const occInstant = Date.parse(`${occ.fecha}T${hora}:00-06:00`)
  if (Number.isNaN(occInstant)) return true
  const anticip = (route.recordatorio_anticipacion_min ?? 1440) * 60000
  return Date.now() >= occInstant - anticip
}

function itemInfo(route: Row): { total: number; tipo: string } {
  const tipo = route.tipo_ruta ?? 'clientes'
  if (tipo === 'contadores') return { total: (route.contador_ids ?? []).length, tipo: 'contadores' }
  if (tipo === 'unidades') return { total: (route.unidad_ids ?? []).length, tipo: 'unidades' }
  return { total: (route.cliente_ids ?? []).length, tipo: 'clientes' }
}

async function resolveRecipients(admin: Client, route: Row): Promise<Recipient[]> {
  const byKey = new Map<string, Recipient>()
  const add = (r: Recipient) => {
    const key = r.userId ?? r.email ?? ''
    if (!key) return
    if (!byKey.has(key)) byKey.set(key, r)
  }

  // Operador asignado
  let operadorEmail: string | null = route.asignado_email ?? null
  const operadorUserId: string | null = route.asignado_a ?? null
  if (!operadorEmail && operadorUserId) {
    const { data } = await admin.auth.admin.getUserById(operadorUserId)
    operadorEmail = data?.user?.email ?? null
  }
  if (operadorEmail || operadorUserId) {
    add({ email: operadorEmail, userId: operadorUserId, rol: 'operador' })
  }

  // Administradores de la empresa
  if (route.company_id) {
    const { data: admins } = await admin
      .from('app_users')
      .select('id, role, activo')
      .eq('company_id', route.company_id)
      .in('role', ['company_owner', 'admin'])
      .eq('activo', true)
    for (const a of admins ?? []) {
      const { data } = await admin.auth.admin.getUserById(a.id as string)
      add({ email: data?.user?.email ?? null, userId: a.id as string, rol: 'administrador' })
    }
  }

  return [...byKey.values()]
}

async function processOccurrence(admin: Client, occ: Row, route: Row): Promise<{ emailed: number; notified: number }> {
  const channels: string[] = Array.isArray(route.recordatorio_canales) ? route.recordatorio_canales : ['email', 'app']
  const wantEmail = channels.includes('email')
  const wantApp = channels.includes('app')
  const recipients = await resolveRecipients(admin, route)
  const { total, tipo } = itemInfo(route)
  const fechaFmt = fmtFecha(occ.fecha)
  const horaFmt = hhmm(occ.hora) || hhmm(route.hora_programada)

  let emailed = 0
  let notified = 0

  // ── Email ──
  if (wantEmail && recipients.some(r => r.email)) {
    let empresaNombre = 'AdministraTodo'
    if (route.company_id) {
      const { data: comp } = await admin.from('companies').select('nombre').eq('id', route.company_id).maybeSingle()
      if (comp?.nombre) empresaNombre = comp.nombre as string
    }
    const { data: cfg } = await admin
      .from('company_email_configs')
      .select('id, email, access_token, refresh_token, token_expiry')
      .eq('company_id', route.company_id)
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
        .eq('template_key', 'ruta_recordatorio')
        .eq('is_active', true)
        .eq('company_id', route.company_id)
        .maybeSingle()

      for (const r of recipients) {
        if (!r.email) continue
        const vars: Record<string, string> = {
          to_name: r.rol === 'administrador' ? 'Administrador' : (route.asignado_nombre ?? r.email),
          ruta_nombre: route.nombre ?? '',
          ruta_descripcion: route.descripcion ?? '',
          fecha_ocurrencia: fechaFmt,
          hora_ocurrencia: horaFmt,
          total_items: String(total),
          tipo_items: tipo,
          empresa_nombre: empresaNombre,
          rol_destinatario: r.rol,
          app_url: APP_URL,
        }
        const rendered = customTpl
          ? { subject: applyVars(customTpl.subject as string, vars), html: applyVars(customTpl.html_body as string, vars) }
          : renderRecordatorio(vars)
        try {
          await sendViaGmail(cfg as unknown as EmailConfig, r.email, rendered.subject, rendered.html, admin)
          emailed++
        } catch (err) {
          console.error('[route-reminders] email failed', r.email, String(err))
        }
      }
    } else {
      console.warn('[route-reminders] sin Gmail configurado para company', route.company_id)
    }
  }

  // ── In-app ──
  if (wantApp) {
    const rows = recipients
      .filter(r => r.userId)
      .map(r => ({
        user_id: r.userId,
        company_id: route.company_id ?? null,
        tipo: 'ruta_recordatorio',
        titulo: `Ruta programada: ${route.nombre ?? ''}`,
        cuerpo: `Tienes la ruta "${route.nombre ?? ''}" programada para el ${fechaFmt}${horaFmt ? ` a las ${horaFmt}` : ''}. ${total} ${tipo} por leer.`,
        seccion: 'rutas',
        ruta_id: route.id,
        ocurrencia_id: occ.id,
      }))
    if (rows.length > 0) {
      const { error } = await admin.from('user_notifications').insert(rows)
      if (error) console.error('[route-reminders] in-app insert failed', error.message)
      else notified += rows.length
    }
  }

  await admin.from('ruta_ocurrencias')
    .update({ recordatorio_enviado: true, recordatorio_enviado_at: new Date().toISOString() })
    .eq('id', occ.id)

  return { emailed, notified }
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

    // ── Auth: interno (cron, service key) o admin (JWT) ──
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
      else if (au.role === 'company_owner' || au.role === 'admin') callerCompanyId = au.company_id as string
      else return json({ error: 'Solo administradores pueden enviar recordatorios' }, 403)
    } else {
      return json({ error: 'Unauthorized' }, 401)
    }

    const body = await req.json().catch(() => ({})) as { mode?: string; ruta_id?: string; ocurrencia_id?: string }

    let totalEmailed = 0
    let totalNotified = 0
    let processed = 0

    if (internal && body.mode === 'batch') {
      // Lote: ocurrencias pendientes sin recordatorio dentro de la ventana.
      const horizon = new Date(Date.now() - GT_OFFSET_MS + 2 * 86400000).toISOString().slice(0, 10)
      const { data: occs, error } = await admin
        .from('ruta_ocurrencias')
        .select('*, ruta:rutas(*)')
        .eq('recordatorio_enviado', false)
        .eq('estado', 'pendiente')
        .lte('fecha', horizon)
        .limit(500)
      if (error) return json({ error: error.message }, 500)
      for (const occ of occs ?? []) {
        const route = (occ as Row).ruta as Row
        if (!route) continue
        if (!isDue(occ as Row, route)) continue
        const res = await processOccurrence(admin, occ as Row, route)
        totalEmailed += res.emailed; totalNotified += res.notified; processed++
      }
    } else {
      // Manual: una ruta/ocurrencia concreta (admin con JWT, o interno con ids).
      let occ: Row | null = null
      let route: Row | null = null

      if (body.ocurrencia_id) {
        const { data } = await admin.from('ruta_ocurrencias').select('*, ruta:rutas(*)').eq('id', body.ocurrencia_id).maybeSingle()
        if (data) { occ = data as Row; route = (data as Row).ruta as Row }
      } else if (body.ruta_id) {
        const { data: r } = await admin.from('rutas').select('*').eq('id', body.ruta_id).maybeSingle()
        route = (r as Row) ?? null
        if (route) {
          // Generar ocurrencias por si la ruta es nueva y aún no tiene.
          await admin.rpc('generar_ocurrencias_rutas', { p_dias_adelante: 60 })
          const hoy = todayGT()
          const { data: ups } = await admin.from('ruta_ocurrencias').select('*')
            .eq('ruta_id', body.ruta_id).eq('estado', 'pendiente')
            .gte('fecha', hoy).order('fecha', { ascending: true }).limit(1)
          if (ups && ups.length) occ = ups[0] as Row
          if (!occ) {
            const { data: past } = await admin.from('ruta_ocurrencias').select('*')
              .eq('ruta_id', body.ruta_id).eq('estado', 'pendiente')
              .order('fecha', { ascending: false }).limit(1)
            if (past && past.length) occ = past[0] as Row
          }
        }
      }

      if (!route || !occ) return json({ error: 'No hay una ocurrencia pendiente para esta ruta' }, 404)

      // Autorización por empresa para el camino admin.
      if (!internal && !callerIsSuperAdmin && route.company_id !== callerCompanyId) {
        return json({ error: 'Forbidden' }, 403)
      }

      const res = await processOccurrence(admin, occ, route)
      totalEmailed += res.emailed; totalNotified += res.notified; processed++
    }

    return json({ success: true, processed, emailed: totalEmailed, notified: totalNotified })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
