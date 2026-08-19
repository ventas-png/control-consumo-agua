// Tests de la lógica pura de notify-package (infra:I22 · Track T8). Como el
// resto de tests de edge fns, corre bajo vitest (no Deno) tratando el módulo
// como TS normal. Cubre: sanitización HTML (escapeHtml aplicado en la plantilla),
// etiqueta de tipo de envío, gate de autorización por empresa, filas in-app,
// normalización de teléfono y payloads/selección de proveedor de WhatsApp.

import { describe, it, expect } from 'vitest'
import {
  TIPO_LABEL,
  type WhatsAppEnv,
  applyVars,
  autorizadoParaEmpresa,
  buildMetaWaPayload,
  buildPaqueteInAppRows,
  buildTwilioWaParams,
  digits,
  escapeHtml,
  renderPaquete,
  resolveWhatsAppProvider,
  tipoLabel,
} from '../logic.ts'

describe('notify-package/escapeHtml (sanitización)', () => {
  it('escapa los 5 caracteres peligrosos', () => {
    expect(escapeHtml(`<script>alert("x") & 'y'</script>`))
      .toBe('&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;')
  })

  it('deja intacto el texto normal (incluidos acentos)', () => {
    expect(escapeHtml('Depósito Nº 3, García')).toBe('Depósito Nº 3, García')
  })
})

describe('notify-package/tipoLabel', () => {
  it('mapea cada tipo a su etiqueta es', () => {
    expect(tipoLabel('paquete')).toBe('Paquete')
    expect(tipoLabel('documento')).toBe('Documento')
    expect(tipoLabel('sobre')).toBe('Sobre')
    expect(tipoLabel('otro')).toBe('Envío')
  })

  it('tipo desconocido cae a "Envío"', () => {
    expect(tipoLabel('caja_gigante')).toBe('Envío')
  })

  it('con clase=correspondencia usa el vocabulario documental', () => {
    // El mismo campo `tipo` lleva dos vocabularios desde la unificación; sin la
    // clase, una notificación legal se anunciaría como "Envío".
    expect(tipoLabel('notificacion_legal', 'correspondencia')).toBe('Notificación legal')
    expect(tipoLabel('carta', 'correspondencia')).toBe('Carta')
    expect(tipoLabel('otro', 'correspondencia')).toBe('Correspondencia')
    expect(tipoLabel('lo_que_sea', 'correspondencia')).toBe('Correspondencia')
    expect(TIPO_LABEL).toEqual({ paquete: 'Paquete', documento: 'Documento', sobre: 'Sobre', otro: 'Envío' })
  })
})

describe('notify-package/autorizadoParaEmpresa (gate por tenant)', () => {
  it('interno (service key) y super_admin pasan siempre', () => {
    expect(autorizadoParaEmpresa({ internal: true, callerIsSuperAdmin: false, callerCompanyId: null }, 'c1')).toBe(true)
    expect(autorizadoParaEmpresa({ internal: false, callerIsSuperAdmin: true, callerCompanyId: 'otra' }, 'c1')).toBe(true)
  })

  it('usuario de empresa solo notifica paquetes de SU empresa (no cross-tenant)', () => {
    expect(autorizadoParaEmpresa({ internal: false, callerIsSuperAdmin: false, callerCompanyId: 'c1' }, 'c1')).toBe(true)
    expect(autorizadoParaEmpresa({ internal: false, callerIsSuperAdmin: false, callerCompanyId: 'c1' }, 'c2')).toBe(false)
  })
})

describe('notify-package/applyVars', () => {
  it('sustituye {{var}} y deja vacío lo desconocido', () => {
    expect(applyVars('{{tipo_label}} para {{unidad}} — {{nada}}', { tipo_label: 'Paquete', unidad: 'A-3' }))
      .toBe('Paquete para A-3 — ')
  })
})

describe('notify-package/renderPaquete', () => {
  const vars = {
    to_name: 'Ana', unidad: 'A-3', descripcion: 'Caja mediana', remitente: 'Amazon',
    empresa_mensajeria: 'DHL', empresa_nombre: 'Mayan', tipo_label: 'Paquete', app_url: 'https://mi.app',
  }

  it('subject incluye tipo y unidad; sin unidad hace trim', () => {
    expect(renderPaquete(vars).subject).toBe('📦 Paquete disponible en portería · A-3')
    expect(renderPaquete({ ...vars, unidad: '' }).subject).toBe('📦 Paquete disponible en portería ·')
  })

  it('escapa HTML del contenido controlado por el usuario (anti-XSS)', () => {
    const out = renderPaquete({ ...vars, descripcion: '<img src=x onerror=alert(1)>', to_name: '<b>Ana</b>' })
    expect(out.html).not.toContain('<img src=x')
    expect(out.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(out.html).toContain('&lt;b&gt;Ana&lt;/b&gt;')
  })

  it('omite las filas de remitente/mensajería cuando vienen vacías', () => {
    const sin = renderPaquete({ ...vars, remitente: '', empresa_mensajeria: '' })
    expect(sin.html).not.toContain('Remitente')
    expect(sin.html).not.toContain('Mensajería')
    const con = renderPaquete(vars)
    expect(con.html).toContain('Remitente')
    expect(con.html).toContain('DHL')
  })

  it('el CTA usa vars.app_url y cae al fallback si viene vacío', () => {
    expect(renderPaquete(vars, 'https://fallback').html).toContain('href="https://mi.app"')
    expect(renderPaquete({ ...vars, app_url: '' }, 'https://fallback').html).toContain('href="https://fallback"')
  })

  it('el correo de correspondencia no promete firmar desde el portal', () => {
    // `paquete_firmar_recepcion` está acotada a clase='paquete'
    // (20260829000000): ofrecer el botón de firma en una carta sería mandar al
    // residente a hacer algo que la base de datos le va a rechazar.
    const out = renderPaquete({ ...vars, clase: 'correspondencia', tipo_label: 'Carta' })
    expect(out.subject).toBe('📬 Carta disponible en administración · A-3')
    expect(out.html).toContain('Ver mi correspondencia')
    expect(out.html).not.toContain('firmar la recepción')
  })
})

describe('notify-package/buildPaqueteInAppRows', () => {
  const vars = { tipo_label: 'Paquete', descripcion: 'Caja', remitente: 'Amazon', unidad: 'A-3' }

  it('una fila por usuario vinculado, con la forma exacta de user_notifications', () => {
    const rows = buildPaqueteInAppRows(['u1', 'u2'], vars, { companyId: 'c1', paqueteId: 'p1' })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      user_id: 'u1',
      company_id: 'c1',
      tipo: 'paquete_pendiente',
      titulo: '📦 Paquete en portería',
      cuerpo: 'Caja · De: Amazon para A-3. Pasa a recogerlo cuando gustes.',
      seccion: 'paquetes',
      paquete_id: 'p1',
    })
  })

  it('sin remitente omite el " · De: ..." del cuerpo; sin usuarios no genera filas', () => {
    const rows = buildPaqueteInAppRows(['u1'], { ...vars, remitente: '' }, { companyId: 'c1', paqueteId: 'p1' })
    expect(rows[0].cuerpo).toBe('Caja para A-3. Pasa a recogerlo cuando gustes.')
    expect(buildPaqueteInAppRows([], vars, { companyId: 'c1', paqueteId: 'p1' })).toEqual([])
  })

  // Motor único (20260829000000): el mismo endpoint avisa las dos clases.
  it('la correspondencia navega a SU pestaña del portal, no a "Mis paquetes"', () => {
    const rows = buildPaqueteInAppRows(
      ['u1'],
      { ...vars, clase: 'correspondencia', tipo_label: 'Notificación legal' },
      { companyId: 'c1', paqueteId: 'c9' },
    )
    // Un aviso de carta que abriera 'paquetes' dejaría al residente mirando una
    // lista donde su carta no está.
    expect(rows[0].seccion).toBe('correspondencia')
    expect(rows[0].tipo).toBe('correspondencia_pendiente')
    expect(rows[0].titulo).toBe('📬 Notificación legal en administración')
  })
})

describe('notify-package/digits', () => {
  it('deja solo dígitos (quita +, espacios, guiones, paréntesis)', () => {
    expect(digits('+502 5555-1234')).toBe('50255551234')
    expect(digits('(502) 5555 1234')).toBe('50255551234')
    expect(digits('')).toBe('')
  })
})

describe('notify-package/resolveWhatsAppProvider', () => {
  const base: WhatsAppEnv = {
    provider: '', metaToken: '', metaPhoneId: '', metaTemplate: '',
    twilioSid: '', twilioToken: '', twilioFrom: '',
  }

  it('meta solo con las 3 credenciales completas', () => {
    const full = { ...base, provider: 'meta', metaToken: 't', metaPhoneId: 'p', metaTemplate: 'tpl' }
    expect(resolveWhatsAppProvider(full)).toBe('meta')
    expect(resolveWhatsAppProvider({ ...full, metaTemplate: '' })).toBe(null)
    expect(resolveWhatsAppProvider({ ...full, metaToken: '' })).toBe(null)
  })

  it('twilio solo con sid+token+from completos', () => {
    const full = { ...base, provider: 'twilio', twilioSid: 's', twilioToken: 't', twilioFrom: 'whatsapp:+1' }
    expect(resolveWhatsAppProvider(full)).toBe('twilio')
    expect(resolveWhatsAppProvider({ ...full, twilioFrom: '' })).toBe(null)
  })

  it('no cae de un proveedor al otro ni acepta proveedores desconocidos', () => {
    // Provider dice meta pero solo hay credenciales de twilio → canal omitido.
    expect(resolveWhatsAppProvider({
      ...base, provider: 'meta', twilioSid: 's', twilioToken: 't', twilioFrom: 'f',
    })).toBe(null)
    expect(resolveWhatsAppProvider({ ...base, provider: 'vonage' })).toBe(null)
    expect(resolveWhatsAppProvider(base)).toBe(null)
  })
})

describe('notify-package/buildMetaWaPayload', () => {
  it('arma el payload de plantilla con unidad y descripción EN ESE ORDEN', () => {
    const payload = buildMetaWaPayload('+502 5555-1234', { unidad: 'A-3', descripcion: 'Caja' }, 'paquete_v1', 'es')
    expect(payload).toEqual({
      messaging_product: 'whatsapp',
      to: '50255551234',
      type: 'template',
      template: {
        name: 'paquete_v1',
        language: { code: 'es' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: 'A-3' },
            { type: 'text', text: 'Caja' },
          ],
        }],
      },
    })
  })
})

describe('notify-package/buildTwilioWaParams', () => {
  it('To en formato whatsapp:+<dígitos> y Body con tipo/unidad/descripción', () => {
    const params = buildTwilioWaParams('+502 5555-1234', { tipo_label: 'Paquete', unidad: 'A-3', descripcion: 'Caja' }, 'whatsapp:+14155238886')
    expect(params).toEqual({
      From: 'whatsapp:+14155238886',
      To: 'whatsapp:+50255551234',
      Body: '📦 Tienes Paquete en portería para A-3: Caja. Pasa a recogerlo cuando gustes.',
    })
  })
})
