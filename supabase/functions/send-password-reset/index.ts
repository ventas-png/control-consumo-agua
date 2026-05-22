import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'

// ---------------------------------------------------------------------------
// Password reset delivered from the platform (super admin) Gmail account.
//
// Flow:
//   1. Generate a native Supabase recovery link (secure, single-use token).
//   2. Deliver that link via the super admin's connected Gmail account so the
//      email comes from the platform's definitive address.
//   3. If the Gmail account is not connected or the send fails, fall back to
//      Supabase's own recovery email so a user is NEVER left unable to reset.
//
// Always responds with a generic success to avoid account enumeration.
// Public endpoint (verify_jwt = false) — the user is not authenticated.
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? ''
const PLATFORM_NAME = Deno.env.get('PLATFORM_NAME') ?? 'AdministraTodo'

interface EmailConfig {
  id: string
  email: string
  access_token: string
  refresh_token: string | null
  token_expiry: string | null
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// ---------------------------------------------------------------------------
// Gmail token refresh + send (mirrors supabase/functions/send-email)
// ---------------------------------------------------------------------------

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
  await supabase
    .from('company_email_configs')
    .update({ access_token: data.access_token, token_expiry: newExpiry })
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
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function sendViaGmail(
  config: EmailConfig,
  to: string,
  subject: string,
  htmlBody: string,
  supabase: ReturnType<typeof createClient>,
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
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(`Gmail API: ${JSON.stringify(err)}`)
  }
}

function resetEmailHtml(platform: string, resetLink: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${platform}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:600px;">
      <tr><td style="background:linear-gradient(135deg,#0ea5e9,#0d9488);padding:28px 32px;text-align:center;">
        <span style="color:#ffffff;font-size:22px;font-weight:700;">${platform}</span>
      </td></tr>
      <tr><td style="padding:32px;">
        <h2 style="margin:0 0 4px;color:#0f172a;font-size:20px;">Restablecer Contraseña</h2>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Recibimos una solicitud para restablecer la contraseña de tu cuenta en <strong>${platform}</strong>.</p>
        <div style="text-align:center;margin:32px 0;">
          <a href="${resetLink}" style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#0d9488);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:700;">Restablecer Contraseña</a>
        </div>
        <p style="margin:0 0 8px;font-size:13px;color:#64748b;">O copia este enlace en tu navegador:</p>
        <p style="margin:0 0 24px;font-size:12px;color:#0ea5e9;word-break:break-all;">${resetLink}</p>
        <div style="background:#fef3c7;border-radius:8px;border:1px solid #fcd34d;padding:12px 16px;">
          <p style="margin:0;font-size:12px;color:#92400e;font-weight:600;">Si no solicitaste este cambio, ignora este correo. El enlace expira automáticamente.</p>
        </div>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:18px 32px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="margin:0;font-size:12px;color:#94a3b8;">Este correo fue enviado automáticamente por ${platform}. Por favor no responda directamente.</p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Generic response — identical regardless of whether the email exists, to
  // prevent account enumeration.
  const genericOk = () =>
    new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let email = ''
  try {
    const body = await req.json() as { email?: string }
    email = (body.email ?? '').trim().toLowerCase()
  } catch {
    return genericOk()
  }

  if (!email || !isValidEmail(email)) {
    return genericOk()
  }

  const redirectTo = APP_URL || origin || undefined

  try {
    // 1. Generate a native Supabase recovery link (secure token, single use).
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: redirectTo ? { redirectTo } : undefined,
    })

    const actionLink = linkData?.properties?.action_link
    if (linkError || !actionLink) {
      // Email has no account — respond generically (no enumeration).
      return genericOk()
    }

    // 2. Deliver via the super admin's connected Gmail account.
    const { data: config } = await admin
      .from('company_email_configs')
      .select('id, email, access_token, refresh_token, token_expiry')
      .eq('is_active', true)
      .eq('is_superadmin', true)
      .maybeSingle()

    if (config && (config as EmailConfig).access_token) {
      try {
        await sendViaGmail(
          config as EmailConfig,
          email,
          `Restablecer contraseña | ${PLATFORM_NAME}`,
          resetEmailHtml(PLATFORM_NAME, actionLink),
          admin,
        )
        return genericOk()
      } catch (_gmailErr) {
        // fall through to Supabase native mailer
      }
    }

    // 3. Fallback: let Supabase send its own recovery email.
    await admin.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined)
    return genericOk()
  } catch (_err) {
    // Last-resort fallback so the user still receives a reset link.
    try {
      await admin.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined)
    } catch { /* ignore */ }
    return genericOk()
  }
})
