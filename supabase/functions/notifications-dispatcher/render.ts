// Lógica pura de render/plantillas de notifications-dispatcher, extraída del
// handler para testearla en aislamiento (infra:I22 · Track T8). Sin Deno ni
// supabase-js → corre en vitest. El handler (index.ts) importa estos símbolos;
// el comportamiento no cambia, solo se mueve la definición a un archivo importable.
//
// La resolución de plantilla del handler mezcla I/O (3 queries) con la decisión
// de "qué fuente gana y cómo se renderiza el resultado". Aquí extraemos SOLO la
// parte de decisión pura (`resolveEmailContent`) recibiendo los candidatos ya
// leídos; el handler sigue haciendo las queries en cascada y corto-circuita igual.

export function asString(v: unknown): string {
  if (v == null) return ''
  return typeof v === 'string' ? v : String(v)
}

// Sustituye {{var}} con payload (mismo motor que send-email / route-reminders).
export function applyVars(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => asString(vars[k]))
}

export function emailLayout(content: string, empresa: string): string {
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

// Header From RFC 2047 (codifica el display name en base64 UTF-8). Idéntico al handler.
export function formatFromHeader(fromEmail: string, fromName: string | null): string {
  if (!fromName) return fromEmail
  const encoded = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(fromName)))}?=`
  return `"${encoded}" <${fromEmail}>`
}

// `true` si el cuerpo ya parece un documento HTML completo (no envolver en layout).
export function looksLikeFullHtml(htmlBody: string): boolean {
  return /<html|<body|<table/i.test(htmlBody)
}

// ---------------------------------------------------------------------------
// Resolución de plantilla de email — cascada (decisión pura)
// ---------------------------------------------------------------------------

/** Plantilla de notification_templates (tenant → global). subject puede ser null. */
export interface NotifTemplate {
  subject: string | null
  body: string
}

/** Override de email_templates (HTML completo existente). */
export interface EmailTemplate {
  subject: string
  html_body: string
}

/** Entradas ya resueltas (las queries las hace el handler) para decidir el contenido. */
export interface EmailContentInputs {
  /** subject/html_body del payload directo (fallback final). */
  payloadSubject: string
  payloadHtmlBody: string
  /** Nombre de empresa para el layout y el subject por defecto. */
  empresaNombre: string
  /** Variables para sustituir {{...}} (incluye payload + empresa_nombre + app_url). */
  vars: Record<string, unknown>
  /** Resultado de notification_templates (tenant → global), o null si no hay. */
  notifTpl: NotifTemplate | null
  /** Resultado de email_templates por template_key, o null. Solo se mira si no hay notifTpl. */
  emailTpl: EmailTemplate | null
}

/** Resultado de la resolución: subject + body finales, o un error no-retriable. */
export type EmailContent =
  | { ok: true; subject: string; htmlBody: string }
  | { ok: false; error: string }

/**
 * Decide el subject/body finales replicando la cascada del handler:
 *   1) notification_templates (tenant→global) → renderiza body con layout estándar.
 *   2) si no, email_templates (override HTML) → usa su subject/html_body con vars.
 *   3) si no, payload directo subject/html_body|body.
 * Reglas post-cascada (idénticas al handler):
 *   - sin htmlBody → error no-retriable.
 *   - sin subject → `Notificación de <empresa>`.
 *   - si el body no parece HTML completo → se envuelve en el layout estándar.
 */
export function resolveEmailContent(input: EmailContentInputs): EmailContent {
  let subject = input.payloadSubject
  let htmlBody = input.payloadHtmlBody

  if (input.notifTpl) {
    subject = applyVars(input.notifTpl.subject ?? subject, input.vars)
    htmlBody = emailLayout(applyVars(input.notifTpl.body, input.vars), input.empresaNombre)
  } else if (input.emailTpl) {
    subject = applyVars(input.emailTpl.subject, input.vars)
    htmlBody = applyVars(input.emailTpl.html_body, input.vars)
  }

  if (!htmlBody) return { ok: false, error: 'email sin body ni plantilla resoluble' }
  if (!subject) subject = `Notificación de ${input.empresaNombre}`
  if (!looksLikeFullHtml(htmlBody)) htmlBody = emailLayout(htmlBody, input.empresaNombre)
  return { ok: true, subject, htmlBody }
}

// ---------------------------------------------------------------------------
// Routing de canal (decisión pura)
// ---------------------------------------------------------------------------

export type Channel = 'in_app' | 'email' | 'whatsapp' | 'push'

export interface ChannelRouting {
  /** Canal soportado por el dispatcher hoy (in_app / email). */
  supported: boolean
  /** Mensaje de error para canales no soportados / desconocidos. */
  error?: string
}

/**
 * Clasifica el canal: in_app/email son soportados; whatsapp/push son follow-ups
 * (failed no-retriable); cualquier otro es "desconocido". Espejo del `switch` del
 * handler para fijar el contrato sin tocar el despacho real (que hace I/O).
 */
export function routeChannel(channel: string): ChannelRouting {
  switch (channel) {
    case 'in_app':
    case 'email':
      return { supported: true }
    case 'whatsapp':
      return { supported: false, error: 'canal whatsapp no implementado (follow-up)' }
    case 'push':
      return { supported: false, error: 'canal push no implementado (follow-up)' }
    default:
      return { supported: false, error: `canal desconocido: ${channel}` }
  }
}

/**
 * Determina si un token de acceso de Gmail está (casi) expirado: queda < 5 min de
 * vida. `nowMs` inyectable para test determinista. `null`/sin expiry → no expirado.
 */
export function isTokenExpired(tokenExpiry: string | null, nowMs: number = Date.now()): boolean {
  if (tokenExpiry == null) return false
  return new Date(tokenExpiry).getTime() - nowMs < 5 * 60 * 1000
}

/**
 * Clasifica el status HTTP de la Gmail API como retriable: 429 (quota) o 5xx.
 * 4xx (salvo 429) son terminales (token revocado, request malformado). Espejo de
 * la decisión inline de `sendViaGmail`.
 */
export function isGmailStatusRetriable(status: number): boolean {
  return status === 429 || status >= 500
}

/** Acota el batch al rango [1, MAX_BATCH] con DEFAULT_BATCH como fallback. */
export function clampBatchSize(
  raw: unknown,
  { def, max }: { def: number; max: number },
): number {
  return Math.min(Math.max(Number(raw) || def, 1), max)
}
