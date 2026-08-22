// Lógica pura de notify-package, extraída del handler para poder testearla en
// aislamiento (infra:I22 · Track T8). Sin Deno ni supabase-js → corre directo en
// vitest. El handler (index.ts) importa estos símbolos: el comportamiento no
// cambia, solo se mueve la definición a un archivo importable desde los tests.
//
// Aquí vive SOLO la decisión pura: sanitización HTML, etiqueta de tipo de envío,
// plantilla del correo, filas in-app, payloads de WhatsApp (Meta/Twilio) y la
// selección de proveedor. El I/O (Gmail, WhatsApp APIs, queries) queda en index.ts.

// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>

/** Sustituye {{var}} con vars; variable desconocida → '' (mismo motor que send-email). */
export function applyVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '')
}

/** Escapa & < > " ' para interpolar texto del usuario dentro del HTML del correo. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

// Etiqueta legible del tipo de envío (es). Desconocido → 'Envío'.
export const TIPO_LABEL: Record<string, string> = {
  paquete: 'Paquete', documento: 'Documento', sobre: 'Sobre', otro: 'Envío',
}

// Correspondencia (clase del motor único, migración 20260829000600): el mismo
// campo `tipo` lleva otro vocabulario. 'otro' se resuelve por clase, así que no
// puede vivir en un solo diccionario.
export const TIPO_LABEL_CORRESPONDENCIA: Record<string, string> = {
  carta: 'Carta', notificacion_legal: 'Notificación legal',
  factura: 'Factura', circular: 'Circular', otro: 'Correspondencia',
}

/**
 * Etiqueta del subtipo de la pieza. `clase` decide el diccionario; un subtipo
 * desconocido cae a la etiqueta genérica de su clase.
 */
export function tipoLabel(tipo: string, clase = 'paquete'): string {
  return clase === 'correspondencia'
    ? TIPO_LABEL_CORRESPONDENCIA[tipo] ?? 'Correspondencia'
    : TIPO_LABEL[tipo] ?? 'Envío'
}

/** Textos que cambian entre avisar un paquete y avisar correspondencia. */
export interface CopyPieza {
  icono: string
  /** Dónde se retira: portería vs administración. */
  lugar: string
  /** Sección del portal a la que apunta la notificación in-app. */
  seccion: string
  /** Clave de plantilla de correo personalizable por empresa. */
  templateKey: string
  tipoNotificacion: string
  /** Qué puede hacer el residente al llegar. La correspondencia NO se firma
   *  desde el portal: `paquete_firmar_recepcion` está acotada a clase='paquete'
   *  (20260829000600), así que prometerlo sería mentirle al residente. */
  cta: string
  cierre: string
  /** Cierre corto para el cuerpo de WhatsApp (Twilio, texto libre). */
  cierreWhatsApp: string
}

export function copyPieza(clase: string): CopyPieza {
  return clase === 'correspondencia'
    ? {
        icono: '📬', lugar: 'administración', seccion: 'correspondencia',
        templateKey: 'correspondencia_recibida', tipoNotificacion: 'correspondencia_pendiente',
        cta: 'Ver mi correspondencia',
        cierre: 'Puedes retirarla en administración presentando tu identificación.',
        cierreWhatsApp: 'Puedes retirarla presentando tu identificación.',
      }
    : {
        icono: '📦', lugar: 'portería', seccion: 'paquetes',
        templateKey: 'paquete_recibido', tipoNotificacion: 'paquete_pendiente',
        cta: 'Ver y firmar recepción',
        cierre: 'Al retirarlo podrás firmar la recepción desde tu portal.',
        cierreWhatsApp: 'Pasa a recogerlo cuando gustes.',
      }
}

// ---------------------------------------------------------------------------
// Entrada vs salida
// ---------------------------------------------------------------------------

/**
 * Valores de `direccion` que significan que la pieza SALE del condominio:
 * 'saliente' (correspondencia que la administración despacha) y
 * 'saliente_tercero' (paquetería que un residente deja para que la recoja un
 * mensajero).
 */
export const DIRECCIONES_SALIENTES = ['saliente', 'saliente_tercero']

/**
 * ¿Esta pieza sale del condominio?
 *
 * POR QUÉ IMPORTA AQUÍ: el aviso entero está escrito desde el punto de vista de
 * algo que LLEGÓ — "tienes correspondencia en administración", "pasa a
 * recogerlo". Mandárselo al residente por una pieza que él mismo despachó es
 * decirle que vaya a buscar lo que acaba de entregar. La pestaña ya no lo
 * intenta, pero esta función existe porque la UI no es el único cliente de la
 * edge function: cualquiera con un JWT de la empresa puede invocarla con un id.
 */
export function esPiezaSaliente(direccion: string | null | undefined): boolean {
  return DIRECCIONES_SALIENTES.includes(direccion ?? '')
}

/** Por qué esta pieza NO genera aviso, o null si sí lo genera. */
export type MotivoOmision = 'pieza_saliente' | 'already_notified' | 'no_cliente'

/**
 * Decide, mirando la fila (con `unidades` embebido), si hay que avisar.
 *
 * Es la regla completa del servidor en una función pura, para que se pueda
 * probar sin levantar el handler. El orden importa: una salida no se avisa
 * NUNCA, ni siquiera para marcarla como ya notificada.
 */
export function motivoOmision(pkg: Row): MotivoOmision | null {
  if (esPiezaSaliente(pkg.direccion as string | null)) return 'pieza_saliente'
  if (pkg.notificado_at) return 'already_notified'
  // Correspondencia dirigida a la administración (sin unidad): no hay residente
  // a quién avisar. La administradora la ve en su pestaña y el Panel General le
  // alerta de los plazos.
  const unidad = pkg.unidades as Row | null
  if (!unidad?.cliente_id) return 'no_cliente'
  return null
}

// ---------------------------------------------------------------------------
// Autorización por empresa (camino con JWT)
// ---------------------------------------------------------------------------

// AQUÍ YA NO HAY RBAC. Lo hubo —`tienePermiso`, `accedeAlProyecto` y
// `puedeNotificar` espejaban en TypeScript lo que hacen `user_has_permission` y
// `can_access_project`— y el espejo divergió: se quedó sin la rama del DENY
// explícito, que en la base VENCE a cualquier allow. La decisión vive ahora en
// `./autorizacion.ts`, que pregunta a esos mismos helpers con un cliente
// limitado al JWT del usuario en vez de reproducir su semántica.
//
// Lo único que queda de este lado es el MAPA clase → clave de permiso, que no
// es semántica de RBAC sino vocabulario de la aplicación.

/** Clave RBAC que gobierna una pieza, según su clase. */
export function permisoDeClase(clase: string | null | undefined): string {
  return clase === 'correspondencia'
    ? 'condominios.tab.correspondencia'
    : 'condominios.tab.paqueteria'
}

// ---------------------------------------------------------------------------
// Plantilla del correo
// ---------------------------------------------------------------------------

export function baseLayout(content: string, empresa: string): string {
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

/**
 * Render por defecto del aviso de paquete (cuando el tenant no tiene
 * email_template custom). `fallbackAppUrl` sustituye al APP_URL de módulo del
 * handler: el CTA usa `vars.app_url` y cae a este fallback si viene vacío.
 */
export function renderPaquete(
  vars: Record<string, string>,
  fallbackAppUrl = '',
): { subject: string; html: string } {
  const empresa = vars.empresa_nombre || 'AdministraTodo'
  const copy = copyPieza(vars.clase ?? 'paquete')
  const content = `
    <h2 style="margin:0 0 4px;color:#0f172a;font-size:20px;">${copy.icono} ${escapeHtml(vars.tipo_label)} en ${copy.lugar}</h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Hola <strong>${escapeHtml(vars.to_name || '')}</strong>, recibimos un envío para tu unidad y está disponible para que lo retires.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:24px;">
      <tr style="background:#0d9488;"><td colspan="2" style="padding:12px 18px;color:#fff;font-weight:700;font-size:13px;">DETALLE DEL ENVÍO</td></tr>
      <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Unidad</td><td style="padding:10px 18px;font-size:14px;color:#0f172a;font-weight:700;text-align:right;border-bottom:1px solid #e2e8f0;">${escapeHtml(vars.unidad || '—')}</td></tr>
      <tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Descripción</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;text-align:right;border-bottom:1px solid #e2e8f0;">${escapeHtml(vars.descripcion || '—')}</td></tr>
      ${vars.remitente ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Remitente</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;text-align:right;border-bottom:1px solid #e2e8f0;">${escapeHtml(vars.remitente)}</td></tr>` : ''}
      ${vars.empresa_mensajeria ? `<tr><td style="padding:10px 18px;font-size:13px;color:#64748b;">Mensajería</td><td style="padding:10px 18px;font-size:13px;color:#0f172a;text-align:right;">${escapeHtml(vars.empresa_mensajeria)}</td></tr>` : ''}
    </table>
    <div style="text-align:center;margin:28px 0;"><a href="${vars.app_url || fallbackAppUrl}" style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#0d9488);color:#fff;text-decoration:none;padding:13px 32px;border-radius:10px;font-size:15px;font-weight:700;">${copy.cta}</a></div>
    <p style="margin:0;font-size:13px;color:#64748b;">${copy.cierre}</p>`
  return {
    subject: `${copy.icono} ${vars.tipo_label} disponible en ${copy.lugar} · ${vars.unidad || ''}`.trim(),
    html: baseLayout(content, empresa),
  }
}

// ---------------------------------------------------------------------------
// Rows in-app (user_notifications)
// ---------------------------------------------------------------------------

/**
 * Construye las filas de user_notifications para los usuarios de app vinculados
 * al residente (el INSERT lo hace el handler). Usa vars.tipo_label / descripcion /
 * remitente / unidad, que el handler arma desde el paquete.
 */
export function buildPaqueteInAppRows(
  userIds: string[],
  vars: Record<string, string>,
  ctx: { companyId: string | null; paqueteId: string },
): Row[] {
  // `seccion` decide a qué pestaña del portal navega el aviso, así que tiene
  // que seguir a la clase: una carta que abre "Mis paquetes" deja al residente
  // mirando una lista donde su carta no está.
  const copy = copyPieza(vars.clase ?? 'paquete')
  return userIds.map(userId => ({
    user_id: userId,
    company_id: ctx.companyId,
    tipo: copy.tipoNotificacion,
    titulo: `${copy.icono} ${vars.tipo_label} en ${copy.lugar}`,
    cuerpo: `${vars.descripcion}${vars.remitente ? ` · De: ${vars.remitente}` : ''} para ${vars.unidad}. Pasa a recogerlo cuando gustes.`,
    seccion: copy.seccion,
    paquete_id: ctx.paqueteId,
  }))
}

// ---------------------------------------------------------------------------
// WhatsApp (payloads puros + selección de proveedor)
// ---------------------------------------------------------------------------

/** Deja solo dígitos del teléfono (formato E.164 sin '+' para las APIs). */
export function digits(phone: string): string { return phone.replace(/[^\d]/g, '') }

/** Config de entorno de WhatsApp (los env vars, ya leídos por el handler). */
export interface WhatsAppEnv {
  provider: string
  metaToken: string
  metaPhoneId: string
  metaTemplate: string
  /**
   * Plantilla aprobada por Meta para CORRESPONDENCIA. Sin ella el canal se
   * omite para esa clase: ver `plantillaMeta`.
   */
  metaTemplateCorrespondencia?: string
  twilioSid: string
  twilioToken: string
  twilioFrom: string
}

/**
 * Plantilla de Meta que corresponde a la clase, o null si no está configurada.
 *
 * POR QUÉ null Y NO UN FALLBACK: una plantilla de Meta es un texto fijo,
 * aprobado, con parámetros posicionales. La de paquetería dice que hay un
 * paquete esperando en portería. Usarla para anunciar una notificación legal le
 * mandaría al residente un mensaje FALSO por un canal que él no puede
 * contrastar — y además rompería el contrato de la plantilla aprobada. Preferimos
 * no mandar WhatsApp: el aviso in-app y el correo sí salen, con su texto correcto.
 */
export function plantillaMeta(env: WhatsAppEnv, clase = 'paquete'): string | null {
  const t = clase === 'correspondencia' ? env.metaTemplateCorrespondencia : env.metaTemplate
  return t && t.trim() !== '' ? t : null
}

/**
 * Decide qué proveedor de WhatsApp usar: 'meta' o 'twilio' SOLO si el proveedor
 * elegido tiene TODAS sus credenciales; si no, null (canal omitido en silencio,
 * el handler responde 'not_configured'). Nunca cae de un proveedor al otro.
 *
 * Para 'meta', las credenciales incluyen LA PLANTILLA DE ESA CLASE (ver
 * `plantillaMeta`). Twilio manda texto libre, así que le basta con las suyas.
 */
export function resolveWhatsAppProvider(env: WhatsAppEnv, clase = 'paquete'): 'meta' | 'twilio' | null {
  if (env.provider === 'meta' && env.metaToken && env.metaPhoneId && plantillaMeta(env, clase)) return 'meta'
  if (env.provider === 'twilio' && env.twilioSid && env.twilioToken && env.twilioFrom) return 'twilio'
  return null
}

/**
 * Payload de la WhatsApp Cloud API (Meta). Mensaje iniciado por la empresa ⇒
 * requiere plantilla aprobada; los parámetros del body son unidad y descripción
 * EN ESE ORDEN (contrato con la plantilla registrada en Meta).
 */
export function buildMetaWaPayload(
  to: string,
  vars: Record<string, string>,
  template: string,
  lang: string,
): Row {
  return {
    messaging_product: 'whatsapp',
    to: digits(to),
    type: 'template',
    template: {
      name: template,
      language: { code: lang },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: vars.unidad },
          { type: 'text', text: vars.descripcion },
        ],
      }],
    },
  }
}

/**
 * Parámetros del mensaje de Twilio: To en formato `whatsapp:+<dígitos>` y el
 * texto libre del aviso (Twilio sí permite mensajes sin plantilla en sandbox).
 */
export function buildTwilioWaParams(
  to: string,
  vars: Record<string, string>,
  from: string,
): Record<string, string> {
  // Twilio manda texto libre, así que el mensaje SÍ se adapta a la clase
  // (icono, lugar de retiro y cierre). Es la diferencia con Meta, donde el texto
  // vive en una plantilla aprobada y no lo escribimos nosotros.
  const copy = copyPieza(vars.clase ?? 'paquete')
  return {
    From: from,
    To: `whatsapp:+${digits(to)}`,
    Body: `${copy.icono} Tienes ${vars.tipo_label} en ${copy.lugar} para ${vars.unidad}: ${vars.descripcion}. ${copy.cierreWhatsApp}`,
  }
}
