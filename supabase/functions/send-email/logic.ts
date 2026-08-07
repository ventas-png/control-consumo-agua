// Lógica pura de send-email, extraída del handler para poder testearla en
// aislamiento (infra:I22 · Track T8/T5). Sin Deno ni supabase-js → corre directo
// en vitest. El handler (index.ts) importa estos símbolos: el comportamiento no
// cambia, solo se mueve la definición a un archivo importable desde los tests.

// El guard anti-inyección vive en _shared/emailHeaders.ts, que es puro:
// importarlo no rompe la pureza de este módulo.
import { assertEmailAddress } from '../_shared/emailHeaders.ts'

// ---------------------------------------------------------------------------
// Build RFC 2822 message base64url-encoded for Gmail API
// ---------------------------------------------------------------------------

// Construye un From con display name si fromName esta presente:
// `"AdministraTodo" <noreply@admin.com>`. RFC 5322 + encoding UTF-8 del
// display name por si trae acentos.
export function formatFromHeader(fromEmail: string, fromName: string | null): string {
  if (!fromName) return fromEmail
  const encoded = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(fromName)))}?=`
  return `"${encoded}" <${fromEmail}>`
}

export function buildRawMessage(
  fromEmail: string,
  fromName: string | null,
  replyTo: string | null,
  to: string,
  subject: string,
  htmlBody: string,
  // Nonce del boundary MIME: inyectable para que el test sea determinista sin
  // tocar el reloj global (el handler no lo pasa → Date.now(), igual que antes).
  boundaryNonce: number = Date.now(),
): string {
  // PR-15: el destinatario se VALIDA antes de entrar en la cabecera. `To` es la
  // única cabecera de este mensaje que no va codificada en base64, así que es la
  // única por la que se puede inyectar (`\r\nBcc: ...`). Lanza en vez de sanear:
  // recortar los CRLF en silencio enviaría a un destinatario distinto del pedido.
  const safeTo = assertEmailAddress('To', to)
  const safeReplyTo = replyTo ? assertEmailAddress('Reply-To', replyTo) : null
  const boundary = `----=_Part_${boundaryNonce}`
  const lines = [
    `From: ${formatFromHeader(fromEmail, fromName)}`,
    `To: ${safeTo}`,
    ...(safeReplyTo ? [`Reply-To: ${safeReplyTo}`] : []),
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

// ---------------------------------------------------------------------------
// HTML Templates
// ---------------------------------------------------------------------------

export function baseLayout(content: string, empresa: string, logoUrl = ''): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${empresa}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:600px;">
      <tr><td style="background:linear-gradient(135deg,#0ea5e9,#0d9488);padding:28px 32px;text-align:center;">
        ${logoUrl ? `<img src="${logoUrl}" alt="${empresa}" style="height:48px;margin-bottom:8px;border-radius:8px;"/><br/>` : ''}
        <span style="color:#ffffff;font-size:22px;font-weight:700;">${empresa}</span>
      </td></tr>
      <tr><td style="padding:32px;">${content}</td></tr>
      <tr><td style="background:#f8fafc;padding:18px 32px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="margin:0;font-size:12px;color:#94a3b8;">Este correo fue enviado automáticamente por ${empresa}. Por favor no responda directamente.</p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`
}

export function renderTemplate(key: string, vars: Record<string, string>): { subject: string; html: string } | null {
  const empresa = vars.empresa_nombre ?? 'Control de Consumo de Agua'
  const logo = vars.empresa_logo ?? ''

  if (key === 'recibo') {
    return {
      subject: `Recibo de Consumo${vars.mes ? ' — ' + vars.mes : ''} | ${empresa}`,
      html: baseLayout(`
        <h2 style="margin:0 0 4px;color:#0f172a;font-size:20px;">Recibo de Consumo</h2>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Estimado/a <strong>${vars.nombre_cliente ?? 'Cliente'}</strong>, su recibo está listo.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:24px;">
          <tr style="background:#0ea5e9;"><td colspan="2" style="padding:12px 18px;color:#fff;font-weight:700;font-size:13px;">DETALLE DE CONSUMO</td></tr>
          ${vars.mes ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Período</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.mes}</td></tr>` : ''}
          <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Lectura Anterior</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.lectura_anterior ?? '—'} m³</td></tr>
          <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Lectura Actual</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.lectura_actual ?? '—'} m³</td></tr>
          <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Consumo</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.consumo ?? '—'} m³</td></tr>
          ${vars.tipo_cobro ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Tipo</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.tipo_cobro}</td></tr>` : ''}
          <tr style="background:#f0fdf4;"><td style="padding:14px 18px;font-size:15px;color:#166534;font-weight:700;">TOTAL A PAGAR</td><td style="padding:14px 18px;font-size:18px;color:#16a34a;font-weight:800;text-align:right;">${vars.moneda ?? ''}${vars.total_pagar ?? '0.00'}</td></tr>
        </table>
        <p style="margin:0 0 8px;font-size:13px;color:#64748b;">Fecha de emisión: <strong>${vars.fecha ?? new Date().toLocaleDateString('es-GT')}</strong></p>
        ${vars.fecha_vencimiento ? `<p style="margin:0 0 16px;font-size:13px;color:#dc2626;font-weight:600;">Fecha límite de pago: ${vars.fecha_vencimiento}</p>` : ''}
        <p style="margin:24px 0 0;font-size:13px;color:#64748b;">Si tiene preguntas, comuníquese con ${empresa}.</p>
      `, empresa, logo),
    }
  }

  if (key === 'ruta_asignada') {
    return {
      subject: `Nueva Ruta Asignada: ${vars.ruta_nombre ?? 'Ruta'} | ${empresa}`,
      html: baseLayout(`
        <h2 style="margin:0 0 4px;color:#0f172a;font-size:20px;">Nueva Ruta Asignada</h2>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Hola <strong>${vars.to_name ?? 'Operador'}</strong>, se te ha asignado una nueva ruta.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:24px;">
          <tr style="background:#0d9488;"><td colspan="2" style="padding:12px 18px;color:#fff;font-weight:700;font-size:13px;">DETALLES DE LA RUTA</td></tr>
          <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Nombre</td><td style="padding:10px 18px;font-size:14px;color:#0f172a;font-weight:700;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.ruta_nombre ?? '—'}</td></tr>
          ${vars.ruta_descripcion ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Descripción</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.ruta_descripcion}</td></tr>` : ''}
          ${vars.fecha_programada ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Fecha Programada</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.fecha_programada}</td></tr>` : ''}
          <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;">Clientes</td><td style="padding:10px 18px;font-size:14px;color:#0d9488;font-weight:700;text-align:right;">${vars.total_clientes ?? '0'} clientes</td></tr>
        </table>
        <p style="margin:0;font-size:13px;color:#64748b;">Ingresa al sistema para ver los detalles completos y comenzar la toma de lecturas.</p>
      `, empresa, logo),
    }
  }

  if (key === 'difusion') {
    return {
      subject: vars.subject ?? `Comunicado de ${empresa}`,
      html: baseLayout(`
        <h2 style="margin:0 0 4px;color:#0f172a;font-size:20px;">${vars.subject ?? 'Comunicado'}</h2>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Estimado/a <strong>${vars.to_name ?? 'Cliente'}</strong>,</p>
        <div style="background:#f8fafc;border-radius:12px;border-left:4px solid #0ea5e9;padding:20px 24px;margin-bottom:24px;">
          <p style="margin:0;font-size:14px;color:#334155;line-height:1.7;white-space:pre-wrap;">${vars.message ?? ''}</p>
        </div>
        ${vars.from_name ? `<p style="margin:0;font-size:13px;color:#64748b;">Atentamente,<br/><strong style="color:#0f172a;">${vars.from_name}</strong><br/>${empresa}</p>` : ''}
      `, empresa, logo),
    }
  }

  if (key === 'password_reset') {
    return {
      subject: `Restablecer contraseña | ${empresa}`,
      html: baseLayout(`
        <h2 style="margin:0 0 4px;color:#0f172a;font-size:20px;">Restablecer Contraseña</h2>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Recibimos una solicitud para restablecer la contraseña de tu cuenta en <strong>${empresa}</strong>.</p>
        <div style="text-align:center;margin:32px 0;">
          <a href="${vars.reset_link ?? '#'}" style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#0d9488);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:700;">Restablecer Contraseña</a>
        </div>
        <p style="margin:0 0 8px;font-size:13px;color:#64748b;">O copia este enlace:</p>
        <p style="margin:0 0 24px;font-size:12px;color:#0ea5e9;word-break:break-all;">${vars.reset_link ?? ''}</p>
        <div style="background:#fef3c7;border-radius:8px;border:1px solid #fcd34d;padding:12px 16px;">
          <p style="margin:0;font-size:12px;color:#92400e;font-weight:600;">⚠️ Este enlace expira en ${vars.hora_expiracion ?? '1 hora'}. Si no solicitaste este cambio, ignora este correo.</p>
        </div>
      `, empresa, logo),
    }
  }

  if (key === 'pago_confirmado') {
    return {
      subject: `Pago confirmado${vars.referencia ? ' — ' + vars.referencia : ''} | ${empresa}`,
      html: baseLayout(`
        <h2 style="margin:0 0 4px;color:#0f172a;font-size:20px;">Pago Confirmado</h2>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Estimado/a <strong>${vars.nombre_cliente ?? 'Cliente'}</strong>, tu pago fue procesado correctamente.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border-radius:12px;border:1px solid #bbf7d0;overflow:hidden;margin-bottom:24px;">
          <tr style="background:#16a34a;"><td colspan="2" style="padding:12px 18px;color:#fff;font-weight:700;font-size:13px;">✅ PAGO PROCESADO</td></tr>
          ${vars.referencia ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #bbf7d0;">Referencia</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;border-bottom:1px solid #bbf7d0;">${vars.referencia}</td></tr>` : ''}
          <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #bbf7d0;">Monto</td><td style="padding:10px 18px;font-size:17px;color:#16a34a;font-weight:800;text-align:right;border-bottom:1px solid #bbf7d0;">${vars.moneda ?? ''}${vars.monto ?? '0.00'}</td></tr>
          ${vars.metodo ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #bbf7d0;">Método</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;border-bottom:1px solid #bbf7d0;">${vars.metodo}</td></tr>` : ''}
          <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;">Fecha</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${vars.fecha ?? new Date().toLocaleDateString('es-GT')}</td></tr>
        </table>
        <p style="margin:0;font-size:13px;color:#64748b;">Conserva este correo como comprobante. Gracias por tu puntualidad.</p>
      `, empresa, logo),
    }
  }

  if (key === 'bienvenida_empresa') {
    const platform = vars.platform_name ?? 'AquaControl'
    return {
      subject: `¡Bienvenido a ${platform}! | ${vars.empresa_nombre ?? 'Nueva Empresa'}`,
      html: baseLayout(`
        <h2 style="margin:0 0 4px;color:#0f172a;font-size:20px;">¡Bienvenido/a, <span style="color:#0ea5e9;">${vars.empresa_nombre ?? 'Nueva Empresa'}</span>!</h2>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Tu cuenta en <strong>${platform}</strong> ha sido creada exitosamente.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:24px;">
          <tr style="background:linear-gradient(135deg,#0ea5e9,#0d9488);"><td colspan="2" style="padding:12px 18px;color:#fff;font-weight:700;font-size:13px;">DATOS DE ACCESO</td></tr>
          ${vars.login_email ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Correo</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.login_email}</td></tr>` : ''}
          ${vars.plan ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Plan</td><td style="padding:10px 18px;font-size:13px;color:#0ea5e9;font-weight:700;text-align:right;border-bottom:1px solid #e2e8f0;">${vars.plan}</td></tr>` : ''}
          ${vars.max_projects ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;">Proyectos máximos</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${vars.max_projects}</td></tr>` : ''}
        </table>
        <div style="text-align:center;margin:28px 0;">
          <a href="${vars.app_url ?? '#'}" style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#0d9488);color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:10px;font-size:15px;font-weight:700;">Iniciar Sesión</a>
        </div>
        ${vars.mensaje_adicional ? `<p style="font-size:13px;color:#64748b;line-height:1.7;">${vars.mensaje_adicional}</p>` : ''}
      `, platform, logo),
    }
  }

  if (key === 'notificacion_empresa') {
    const platform = vars.platform_name ?? 'AquaControl'
    return {
      subject: vars.subject ?? `Notificación de ${platform}`,
      html: baseLayout(`
        <h2 style="margin:0 0 4px;color:#0f172a;font-size:20px;">${vars.titulo ?? 'Notificación de Plataforma'}</h2>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Estimado equipo de <strong>${vars.empresa_nombre ?? 'su empresa'}</strong>,</p>
        <div style="background:#f8fafc;border-radius:12px;border-left:4px solid #8b5cf6;padding:20px 24px;margin-bottom:24px;">
          <p style="margin:0;font-size:14px;color:#334155;line-height:1.7;white-space:pre-wrap;">${vars.message ?? ''}</p>
        </div>
        ${vars.cta_url && vars.cta_texto ? `<div style="text-align:center;margin:24px 0;"><a href="${vars.cta_url}" style="display:inline-block;background:linear-gradient(135deg,#8b5cf6,#6366f1);color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:14px;font-weight:700;">${vars.cta_texto}</a></div>` : ''}
        <p style="margin:16px 0 0;font-size:13px;color:#64748b;">Atentamente,<br/><strong>${platform}</strong> — Administración</p>
      `, platform, logo),
    }
  }

  return null
}

export function applyVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '')
}

// ---------------------------------------------------------------------------
// HTML-safe variable rendering (anti HTML/link injection in the email body)
// ---------------------------------------------------------------------------

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Solo se permiten esquemas http(s) y mailto en vars de URL; cualquier otra
// cosa (javascript:, data:, etc.) se neutraliza a '#'.
export function sanitizeUrl(s: string): string {
  const t = s.trim()
  return /^(https?:\/\/|mailto:)/i.test(t) ? t : '#'
}

// Escapa cada var para interpolarla en el CUERPO HTML. Las claves que son URLs
// (terminan en _link/_url, o logo) además se validan por esquema.
export function sanitizeVars(vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(vars ?? {})) {
    const val = v == null ? '' : String(v)
    const isUrl = /(_link|_url)$/.test(k) || k === 'empresa_logo' || k === 'logo'
    out[k] = escapeHtml(isUrl ? sanitizeUrl(val) : val)
  }
  return out
}
// ---------------------------------------------------------------------------
// Token expiry (extraído inline de sendViaGmail)
// ---------------------------------------------------------------------------

// Ventana de refresh: el token se considera expirado si le quedan < 5 min de
// vida. `nowMs` inyectable para test determinista. Sin expiry → no expirado.
export const TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000

export function isTokenExpired(tokenExpiry: string | null, nowMs: number = Date.now()): boolean {
  return tokenExpiry != null &&
    new Date(tokenExpiry).getTime() - nowMs < TOKEN_REFRESH_WINDOW_MS
}

// ---------------------------------------------------------------------------
// Scope efectivo del envío (gate de autorización — decisión pura)
// ---------------------------------------------------------------------------

// Roles de staff de tenant que pueden enviar correo (espejo del check del handler).
export const EMAIL_SENDER_ROLES = ['admin', 'company_owner', 'operator', 'operador']

export type EmailScope =
  | { ok: true; isSuperadmin: boolean; companyId: string | null }
  | { ok: false; error: string }

/**
 * Decide el scope EFECTIVO del envío (qué cuenta de Gmail manda) a partir del
 * rol/empresa REAL del caller — NUNCA se confía en company_id/is_superadmin del
 * body. Réplica exacta de la decisión del handler:
 *   - is_superadmin pedido → solo super_admin/superadmin.
 *   - staff de tenant (no super) → solo EMAIL_SENDER_ROLES y SIEMPRE acotado a
 *     su propia empresa (se ignora cualquier company_id del body).
 *   - super_admin con is_superadmin=false → puede enviar a nombre del company_id pedido.
 */
export function resolveEmailScope(
  requested: { isSuperadmin: boolean; companyId: string | null },
  caller: { role: string; companyId: string | null },
): EmailScope {
  const isSuper = caller.role === 'super_admin' || caller.role === 'superadmin'

  if (requested.isSuperadmin) {
    if (!isSuper) {
      return { ok: false, error: 'Solo un super administrador puede enviar correo de plataforma' }
    }
    return { ok: true, isSuperadmin: true, companyId: requested.companyId }
  }

  if (!isSuper) {
    if (!EMAIL_SENDER_ROLES.includes(caller.role) || !caller.companyId) {
      return { ok: false, error: 'No autorizado para enviar correo' }
    }
    return { ok: true, isSuperadmin: false, companyId: caller.companyId }
  }

  // Un super_admin con is_superadmin=false puede enviar a nombre del company_id pedido.
  return { ok: true, isSuperadmin: false, companyId: requested.companyId }
}
