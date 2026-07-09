// Lógica pura de route-reminders, extraída del handler para poder testearla en
// aislamiento (infra:I22 · Track T8). Sin Deno ni supabase-js → corre directo en
// vitest. El handler (index.ts) importa estos símbolos: el comportamiento no
// cambia, solo se mueve la definición a un archivo importable desde los tests.
//
// Aquí vive SOLO la decisión pura: ventanas de fechas (Guatemala UTC-6),
// vencimiento del recordatorio, agrupación/dedupe de destinatarios, plantilla
// del correo y construcción de rows in-app. El I/O (Gmail, queries, RPC) se
// queda en index.ts.

// Guatemala is UTC-6 year-round (no DST), so a fixed offset is safe.
export const GT_OFFSET_MS = 6 * 60 * 60 * 1000

// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>

export interface Recipient {
  email: string | null
  userId: string | null
  rol: 'operador' | 'administrador'
}

// ---------------------------------------------------------------------------
// Fechas / ventanas (hora Guatemala)
// ---------------------------------------------------------------------------

/** Fecha de "hoy" en Guatemala (YYYY-MM-DD). `nowMs` inyectable para tests. */
export function todayGT(nowMs: number = Date.now()): string {
  return new Date(nowMs - GT_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * Horizonte del modo batch: hoy GT + 2 días (YYYY-MM-DD). Es el `lte('fecha')`
 * del query de ocurrencias pendientes; `isDue` afina después por hora/anticipación.
 */
export function batchHorizonDate(nowMs: number = Date.now()): string {
  return new Date(nowMs - GT_OFFSET_MS + 2 * 86400000).toISOString().slice(0, 10)
}

/** YYYY-MM-DD → DD/MM/YYYY (formato del correo/notificación). */
export function fmtFecha(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/** Recorta un time SQL (HH:MM:SS) a HH:MM; vacío si no hay hora. */
export function hhmm(t: string | null | undefined): string {
  return t ? String(t).slice(0, 5) : ''
}

/**
 * ¿Ya toca enviar el recordatorio de esta ocurrencia? La hora efectiva es la de
 * la ocurrencia → la de la ruta → 08:00, interpretada en GT (-06:00). Se envía
 * cuando `now >= instante - anticipación` (default 1440 min = 1 día). Fecha
 * imparseable → `true` (mejor recordar de más que perder el aviso).
 * `nowMs` inyectable para tests deterministas.
 */
export function isDue(occ: Row, route: Row, nowMs: number = Date.now()): boolean {
  const hora = hhmm(occ.hora) || hhmm(route.hora_programada) || '08:00'
  const occInstant = Date.parse(`${occ.fecha}T${hora}:00-06:00`)
  if (Number.isNaN(occInstant)) return true
  const anticip = (route.recordatorio_anticipacion_min ?? 1440) * 60000
  return nowMs >= occInstant - anticip
}

/** Total de ítems por leer y su tipo según el tipo de ruta (default clientes). */
export function itemInfo(route: Row): { total: number; tipo: string } {
  const tipo = route.tipo_ruta ?? 'clientes'
  if (tipo === 'contadores') return { total: (route.contador_ids ?? []).length, tipo: 'contadores' }
  if (tipo === 'unidades') return { total: (route.unidad_ids ?? []).length, tipo: 'unidades' }
  return { total: (route.cliente_ids ?? []).length, tipo: 'clientes' }
}

// ---------------------------------------------------------------------------
// Agrupación por destinatario
// ---------------------------------------------------------------------------

/**
 * Dedupe de destinatarios por clave `userId ?? email` (primero gana: el operador
 * asignado se agrega antes que los administradores, así conserva su rol si es
 * también admin). Entradas sin userId ni email se descartan.
 */
export function dedupeRecipients(candidates: Recipient[]): Recipient[] {
  const byKey = new Map<string, Recipient>()
  for (const r of candidates) {
    const key = r.userId ?? r.email ?? ''
    if (!key) continue
    if (!byKey.has(key)) byKey.set(key, r)
  }
  return [...byKey.values()]
}

// ---------------------------------------------------------------------------
// Autorización por empresa (camino admin con JWT)
// ---------------------------------------------------------------------------

/**
 * Gate de tenant: interno (service key) y super_admin pasan siempre; un
 * admin/owner solo puede enviar recordatorios de rutas de SU empresa.
 */
export function autorizadoParaEmpresa(
  auth: { internal: boolean; callerIsSuperAdmin: boolean; callerCompanyId: string | null },
  routeCompanyId: string | null,
): boolean {
  return auth.internal || auth.callerIsSuperAdmin || routeCompanyId === auth.callerCompanyId
}

// ---------------------------------------------------------------------------
// Plantilla de recordatorio
// ---------------------------------------------------------------------------

/** Sustituye {{var}} con vars; variable desconocida → '' (mismo motor que send-email). */
export function applyVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '')
}

export function baseLayout(content: string, empresa: string): string {
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

/**
 * Render por defecto del recordatorio (cuando el tenant no tiene email_template
 * custom). `fallbackAppUrl` sustituye al APP_URL de módulo del handler: el CTA
 * usa `vars.app_url` y cae a este fallback si viene vacío.
 */
export function renderRecordatorio(
  vars: Record<string, string>,
  fallbackAppUrl = '',
): { subject: string; html: string } {
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
    <div style="text-align:center;margin:28px 0;"><a href="${vars.app_url || fallbackAppUrl}" style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#0d9488);color:#fff;text-decoration:none;padding:13px 32px;border-radius:10px;font-size:15px;font-weight:700;">Abrir AdministraTodo</a></div>
    <p style="margin:0;font-size:13px;color:#64748b;">Por favor asegúrate de completarla en la fecha indicada.</p>`
  return {
    subject: `Recordatorio de ruta: ${vars.ruta_nombre || 'Ruta'} | ${empresa}`,
    html: baseLayout(content, empresa),
  }
}

/**
 * Variables de plantilla para UN destinatario. `to_name`: los administradores
 * reciben el genérico 'Administrador'; el operador recibe su nombre asignado y,
 * si no hay, su propio email (el caller ya garantiza `r.email` no-nulo).
 */
export function buildReminderVars(
  r: Recipient,
  route: Row,
  ctx: {
    fechaFmt: string
    horaFmt: string
    total: number
    tipo: string
    empresaNombre: string
    appUrl: string
  },
): Record<string, string> {
  return {
    to_name: r.rol === 'administrador' ? 'Administrador' : (route.asignado_nombre ?? r.email),
    ruta_nombre: route.nombre ?? '',
    ruta_descripcion: route.descripcion ?? '',
    fecha_ocurrencia: ctx.fechaFmt,
    hora_ocurrencia: ctx.horaFmt,
    total_items: String(ctx.total),
    tipo_items: ctx.tipo,
    empresa_nombre: ctx.empresaNombre,
    rol_destinatario: r.rol,
    app_url: ctx.appUrl,
  }
}

// ---------------------------------------------------------------------------
// Rows in-app (user_notifications)
// ---------------------------------------------------------------------------

/**
 * Construye las filas de user_notifications para el canal in-app: solo
 * destinatarios con userId; una fila por destinatario con la referencia a la
 * ruta y la ocurrencia (el INSERT lo hace el handler).
 */
export function buildInAppRows(
  recipients: Recipient[],
  route: Row,
  occ: Row,
  ctx: { fechaFmt: string; horaFmt: string; total: number; tipo: string },
): Row[] {
  return recipients
    .filter(r => r.userId)
    .map(r => ({
      user_id: r.userId,
      company_id: route.company_id ?? null,
      tipo: 'ruta_recordatorio',
      titulo: `Ruta programada: ${route.nombre ?? ''}`,
      cuerpo: `Tienes la ruta "${route.nombre ?? ''}" programada para el ${ctx.fechaFmt}${ctx.horaFmt ? ` a las ${ctx.horaFmt}` : ''}. ${ctx.total} ${ctx.tipo} por leer.`,
      seccion: 'rutas',
      ruta_id: route.id,
      ocurrencia_id: occ.id,
    }))
}

// ---------------------------------------------------------------------------
// Mensaje MIME para Gmail API (base64url)
// ---------------------------------------------------------------------------

/**
 * Arma el mensaje RFC 2822 multipart (subject RFC 2047, body HTML en base64)
 * codificado base64url como lo pide la Gmail API. `nowMs` solo alimenta el
 * boundary (inyectable para test determinista).
 */
export function buildRawMessage(
  from: string,
  to: string,
  subject: string,
  htmlBody: string,
  nowMs: number = Date.now(),
): string {
  const boundary = `----=_Part_${nowMs}`
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
