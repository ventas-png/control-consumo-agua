import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmailPayload {
  company_id?: string | null
  is_superadmin?: boolean
  template_key: string
  to_email: string
  to_name?: string
  vars: Record<string, string>
}

interface EmailConfig {
  email: string
  access_token: string
  refresh_token: string | null
  token_expiry: string | null
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
    .update({ access_token: data.access_token, token_expiry: newExpiry })
    .eq('id', configId)

  return data.access_token
}

// ---------------------------------------------------------------------------
// Build RFC 2822 message and base64url-encode it for Gmail API
// ---------------------------------------------------------------------------

function buildRawMessage(from: string, to: string, subject: string, htmlBody: string): string {
  const boundary = `----=_Part_${Date.now()}`
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
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
  const raw = lines.join('\r\n')
  return btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// ---------------------------------------------------------------------------
// Gmail API send
// ---------------------------------------------------------------------------

async function sendViaGmail(
  config: EmailConfig & { id: string },
  to: string,
  subject: string,
  htmlBody: string,
  supabase: ReturnType<typeof createClient>
): Promise<void> {
  let accessToken = config.access_token

  const isExpired =
    config.token_expiry != null &&
    new Date(config.token_expiry).getTime() - Date.now() < 5 * 60 * 1000

  if (isExpired && config.refresh_token) {
    const newToken = await refreshAccessToken(config.refresh_token, supabase, config.id)
    if (newToken) accessToken = newToken
  }

  const raw = buildRawMessage(config.email, to, subject, htmlBody)

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(`Gmail API: ${JSON.stringify(err)}`)
  }
}

// ---------------------------------------------------------------------------
// HTML Templates
// ---------------------------------------------------------------------------

function baseLayout(content: string, empresa: string, logoUrl = ''): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${empresa}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
      <!-- Header -->
      <tr><td style="background:linear-gradient(135deg,#0ea5e9,#0d9488);padding:28px 32px;text-align:center;">
        ${logoUrl ? `<img src="${logoUrl}" alt="${empresa}" style="height:48px;margin-bottom:8px;border-radius:8px;"/><br/>` : ''}
        <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-.3px;">${empresa}</span>
      </td></tr>
      <!-- Content -->
      <tr><td style="padding:32px;">${content}</td></tr>
      <!-- Footer -->
      <tr><td style="background:#f8fafc;padding:18px 32px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="margin:0;font-size:12px;color:#94a3b8;">Este correo fue enviado automáticamente por ${empresa}. Por favor no responda directamente a este mensaje.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

function renderTemplate(key: string, vars: Record<string, string>): { subject: string; html: string } | null {
  const empresa = vars.empresa_nombre ?? 'Control de Consumo de Agua'
  const logo = vars.empresa_logo ?? ''

  switch (key) {
    case 'recibo': {
      const subject = `Recibo de Consumo${vars.mes ? ' — ' + vars.mes : ''} | ${empresa}`
      const content = `
        <h2 style="margin:0 0 4px;color:#0f172a;font-size:20px;">Recibo de Consumo</h2>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Estimado/a <strong>${vars.nombre_cliente ?? 'Cliente'}</strong>, su recibo está listo.</p>

        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:24px;">
          <tr style="background:#0ea5e9;"><td colspan="2" style="padding:12px 18px;color:#fff;font-weight:700;font-size:13px;letter-spacing:.05em;">DETALLE DE CONSUMO</td></tr>
          ${vars.mes ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Período</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.mes}</td></tr>` : ''}
          <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Lectura Anterior</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.lectura_anterior ?? '—'} m³</td></tr>
          <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Lectura Actual</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.lectura_actual ?? '—'} m³</td></tr>
          <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Consumo</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.consumo ?? '—'} m³</td></tr>
          ${vars.tipo_cobro ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Tipo</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.tipo_cobro}</td></tr>` : ''}
          <tr style="background:#f0fdf4;"><td style="padding:14px 18px;font-size:15px;color:#166534;font-weight:700;">TOTAL A PAGAR</td><td style="padding:14px 18px;font-size:18px;color:#16a34a;font-weight:800;text-align:right;">${vars.moneda ?? ''}${vars.total_pagar ?? '0.00'}</td></tr>
        </table>

        <p style="margin:0 0 8px;font-size:13px;color:#64748b;">Fecha de emisión: <strong>${vars.fecha ?? new Date().toLocaleDateString('es-GT')}</strong></p>
        ${vars.fecha_vencimiento ? `<p style="margin:0 0 16px;font-size:13px;color:#dc2626;font-weight:600;">Fecha límite de pago: ${vars.fecha_vencimiento}</p>` : ''}

        <p style="margin:24px 0 0;font-size:13px;color:#64748b;">Si tiene preguntas sobre este recibo, comuníquese con ${empresa}.</p>
      `
      return { subject, html: baseLayout(content, empresa, logo) }
    }

    case 'ruta_asignada': {
      const subject = `Nueva Ruta Asignada: ${vars.ruta_nombre ?? 'Ruta'} | ${empresa}`
      const content = `
        <h2 style="margin:0 0 4px;color:#0f172a;font-size:20px;">Nueva Ruta Asignada</h2>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Hola <strong>${vars.to_name ?? 'Operador'}</strong>, se te ha asignado una nueva ruta de servicio.</p>

        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:24px;">
          <tr style="background:#0d9488;"><td colspan="2" style="padding:12px 18px;color:#fff;font-weight:700;font-size:13px;letter-spacing:.05em;">DETALLES DE LA RUTA</td></tr>
          <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Nombre</td><td style="padding:10px 18px;font-size:14px;color:#0f172a;font-weight:700;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.ruta_nombre ?? '—'}</td></tr>
          ${vars.ruta_descripcion ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Descripción</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.ruta_descripcion}</td></tr>` : ''}
          ${vars.fecha_programada ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Fecha Programada</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.fecha_programada}</td></tr>` : ''}
          <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;">Total de Clientes</td><td style="padding:10px 18px;font-size:14px;color:#0d9488;font-weight:700;text-align:right;">${vars.total_clientes ?? '0'} clientes</td></tr>
        </table>

        <p style="margin:0;font-size:13px;color:#64748b;">Por favor, ingresa al sistema para ver los detalles completos de la ruta y comenzar la toma de lecturas.</p>
      `
      return { subject, html: baseLayout(content, empresa, logo) }
    }

    case 'difusion': {
      const subject = vars.subject ?? `Comunicado de ${empresa}`
      const content = `
        <h2 style="margin:0 0 4px;color:#0f172a;font-size:20px;">${vars.subject ?? 'Comunicado Importante'}</h2>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Estimado/a <strong>${vars.to_name ?? 'Cliente'}</strong>,</p>

        <div style="background:#f8fafc;border-radius:12px;border-left:4px solid #0ea5e9;padding:20px 24px;margin-bottom:24px;">
          <p style="margin:0;font-size:14px;color:#334155;line-height:1.7;white-space:pre-wrap;">${vars.message ?? ''}</p>
        </div>

        ${vars.from_name ? `<p style="margin:0;font-size:13px;color:#64748b;">Atentamente,<br/><strong style="color:#0f172a;">${vars.from_name}</strong><br/>${empresa}</p>` : ''}
      `
      return { subject, html: baseLayout(content, empresa, logo) }
    }

    case 'password_reset': {
      const subject = `Restablecer contraseña | ${empresa}`
      const content = `
        <h2 style="margin:0 0 4px;color:#0f172a;font-size:20px;">Restablecer Contraseña</h2>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Recibimos una solicitud para restablecer la contraseña de tu cuenta en <strong>${empresa}</strong>.</p>

        <div style="text-align:center;margin:32px 0;">
          <a href="${vars.reset_link ?? '#'}" style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#0d9488);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:700;letter-spacing:.02em;">
            Restablecer Contraseña
          </a>
        </div>

        <p style="margin:0 0 8px;font-size:13px;color:#64748b;">O copia y pega este enlace en tu navegador:</p>
        <p style="margin:0 0 24px;font-size:12px;color:#0ea5e9;word-break:break-all;">${vars.reset_link ?? ''}</p>

        <div style="background:#fef3c7;border-radius:8px;border:1px solid #fcd34d;padding:12px 16px;">
          <p style="margin:0;font-size:12px;color:#92400e;font-weight:600;">⚠️ Este enlace expira en ${vars.hora_expiracion ?? '1 hora'}. Si no solicitaste este cambio, ignora este correo.</p>
        </div>
      `
      return { subject, html: baseLayout(content, empresa, logo) }
    }

    case 'bienvenida_empresa': {
      const subject = `¡Bienvenido a la plataforma! | ${vars.platform_name ?? 'AquaControl'}`
      const content = `
        <h2 style="margin:0 0 4px;color:#0f172a;font-size:20px;">¡Bienvenido/a, <span style="color:#0ea5e9;">${vars.empresa_nombre ?? 'Nueva Empresa'}</span>!</h2>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Tu cuenta en <strong>${vars.platform_name ?? 'AquaControl'}</strong> ha sido creada exitosamente.</p>

        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:24px;">
          <tr style="background:linear-gradient(135deg,#0ea5e9,#0d9488);"><td colspan="2" style="padding:12px 18px;color:#fff;font-weight:700;font-size:13px;">DATOS DE ACCESO</td></tr>
          <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Correo</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.login_email ?? '—'}</td></tr>
          ${vars.plan ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Plan</td><td style="padding:10px 18px;font-size:13px;color:#0ea5e9;font-weight:700;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.plan}</td></tr>` : ''}
          ${vars.max_projects ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;">Proyectos máximos</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${vars.max_projects}</td></tr>` : ''}
        </table>

        <div style="text-align:center;margin:28px 0;">
          <a href="${vars.app_url ?? '#'}" style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#0d9488);color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:10px;font-size:15px;font-weight:700;">
            Iniciar Sesión
          </a>
        </div>

        ${vars.mensaje_adicional ? `<p style="font-size:13px;color:#64748b;line-height:1.7;">${vars.mensaje_adicional}</p>` : ''}
      `
      return { subject, html: baseLayout(content, vars.platform_name ?? 'AquaControl', logo) }
    }

    case 'notificacion_empresa': {
      const subject = vars.subject ?? `Notificación de plataforma | ${vars.platform_name ?? 'AquaControl'}`
      const content = `
        <h2 style="margin:0 0 4px;color:#0f172a;font-size:20px;">${vars.titulo ?? 'Notificación de Plataforma'}</h2>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Estimado equipo de <strong>${vars.empresa_nombre ?? 'su empresa'}</strong>,</p>

        <div style="background:#f8fafc;border-radius:12px;border-left:4px solid #8b5cf6;padding:20px 24px;margin-bottom:24px;">
          <p style="margin:0;font-size:14px;color:#334155;line-height:1.7;white-space:pre-wrap;">${vars.message ?? ''}</p>
        </div>

        ${vars.cta_url && vars.cta_texto ? `
        <div style="text-align:center;margin:24px 0;">
          <a href="${vars.cta_url}" style="display:inline-block;background:linear-gradient(135deg,#8b5cf6,#6366f1);color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:14px;font-weight:700;">
            ${vars.cta_texto}
          </a>
        </div>` : ''}

        <p style="margin:16px 0 0;font-size:13px;color:#64748b;">Atentamente,<br/><strong>${vars.platform_name ?? 'AquaControl'}</strong> — Administración</p>
      `
      return { subject, html: baseLayout(content, vars.platform_name ?? 'AquaControl', logo) }
    }

    case 'pago_confirmado': {
      const subject = `Pago confirmado ${vars.referencia ? '— ' + vars.referencia : ''} | ${empresa}`
      const content = `
        <h2 style="margin:0 0 4px;color:#0f172a;font-size:20px;">Pago Confirmado</h2>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Estimado/a <strong>${vars.nombre_cliente ?? 'Cliente'}</strong>, tu pago ha sido procesado correctamente.</p>

        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border-radius:12px;border:1px solid #bbf7d0;overflow:hidden;margin-bottom:24px;">
          <tr style="background:#16a34a;"><td colspan="2" style="padding:12px 18px;color:#fff;font-weight:700;font-size:13px;">✅ PAGO PROCESADO</td></tr>
          ${vars.referencia ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #bbf7d0;">Referencia</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;border-bottom:1px solid #bbf7d0;">${vars.referencia}</td></tr>` : ''}
          <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #bbf7d0;">Monto</td><td style="padding:10px 18px;font-size:17px;color:#16a34a;font-weight:800;text-align:right;border-bottom:1px solid #bbf7d0;">${vars.moneda ?? ''}${vars.monto ?? '0.00'}</td></tr>
          ${vars.metodo ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #bbf7d0;">Método</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;border-bottom:1px solid #bbf7d0;">${vars.metodo}</td></tr>` : ''}
          <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;">Fecha</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${vars.fecha ?? new Date().toLocaleDateString('es-GT')}</td></tr>
        </table>

        <p style="margin:0;font-size:13px;color:#64748b;">Conserva este correo como comprobante de pago. Gracias por tu puntualidad.</p>
      `
      return { subject, html: baseLayout(content, empresa, logo) }
    }

    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Apply custom template variables to a stored template
// ---------------------------------------------------------------------------

function applyVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '')
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json() as EmailPayload
    const { company_id, is_superadmin, template_key, to_email, to_name, vars } = payload

    if (!template_key || !to_email) {
      return new Response(
        JSON.stringify({ error: 'template_key and to_email are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Fetch email config for this company (or superadmin)
    const configQuery = supabase
      .from('company_email_configs')
      .select('id, email, access_token, refresh_token, token_expiry')
      .eq('is_active', true)

    if (is_superadmin) {
      configQuery.eq('is_superadmin', true)
    } else if (company_id) {
      configQuery.eq('company_id', company_id)
    } else {
      return new Response(
        JSON.stringify({ error: 'company_id or is_superadmin required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: config } = await configQuery.maybeSingle()

    if (!config) {
      return new Response(
        JSON.stringify({ error: 'No Gmail account connected for this company' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Merge to_name into vars
    const mergedVars: Record<string, string> = { to_name: to_name ?? '', ...vars }

    // Check for custom template in DB first
    let subject: string
    let htmlBody: string

    const { data: customTpl } = await supabase
      .from('email_templates')
      .select('subject, html_body')
      .eq('template_key', template_key)
      .eq('is_active', true)
      .eq(is_superadmin ? 'is_superadmin' : 'company_id', is_superadmin ? true : company_id)
      .maybeSingle()

    if (customTpl) {
      subject = applyVars(customTpl.subject, mergedVars)
      htmlBody = applyVars(customTpl.html_body, mergedVars)
    } else {
      // Fall back to built-in template
      const rendered = renderTemplate(template_key, mergedVars)
      if (!rendered) {
        return new Response(
          JSON.stringify({ error: `Unknown template_key: ${template_key}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      subject = rendered.subject
      htmlBody = rendered.html
    }

    await sendViaGmail(config as EmailConfig & { id: string }, to_email, subject, htmlBody, supabase)

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
