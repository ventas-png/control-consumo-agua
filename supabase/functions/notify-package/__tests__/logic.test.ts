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
  buildMetaWaPayload,
  buildPaqueteInAppRows,
  buildTwilioWaParams,
  digits,
  escapeHtml,
  type PerfilLlamante,
  accedeAlProyecto,
  esPiezaSaliente,
  motivoOmision,
  permisoDeClase,
  puedeNotificar,
  tienePermiso,
  plantillaMeta,
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

// ── WhatsApp por clase (motor único, 20260829000000) ────────────────────────
// Meta manda PLANTILLAS APROBADAS: su texto es fijo y no lo escribimos nosotros.
// Reutilizar la de paquetería para anunciar correspondencia le mandaría al
// residente un mensaje falso ("tienes un paquete en portería") por un canal que
// no puede contrastar. Twilio manda texto libre, así que ahí sí adaptamos.
describe('notify-package/WhatsApp por clase', () => {
  const envMeta: WhatsAppEnv = {
    provider: 'meta', metaToken: 'tok', metaPhoneId: '123', metaTemplate: 'paquete_es',
    twilioSid: '', twilioToken: '', twilioFrom: '',
  }
  const envTwilio: WhatsAppEnv = {
    provider: 'twilio', metaToken: '', metaPhoneId: '', metaTemplate: '',
    twilioSid: 'AC1', twilioToken: 'tk', twilioFrom: 'whatsapp:+50200000000',
  }
  const varsPaquete = { tipo_label: 'Paquete', descripcion: 'Caja', unidad: 'A-3', clase: 'paquete' }
  const varsCorreo = {
    tipo_label: 'Notificación legal', descripcion: 'Citación', unidad: 'A-3',
    clase: 'correspondencia',
  }

  describe('Meta', () => {
    it('paquetería sigue igual: resuelve meta con su plantilla de siempre', () => {
      expect(resolveWhatsAppProvider(envMeta, 'paquete')).toBe('meta')
      expect(plantillaMeta(envMeta, 'paquete')).toBe('paquete_es')
    })

    it('correspondencia SIN plantilla propia: no se envía por Meta', () => {
      // Preferimos no mandar WhatsApp antes que mandar el texto de paquetes.
      expect(plantillaMeta(envMeta, 'correspondencia')).toBeNull()
      expect(resolveWhatsAppProvider(envMeta, 'correspondencia')).toBeNull()
    })

    it('correspondencia CON plantilla propia: se envía con ESA plantilla', () => {
      const env = { ...envMeta, metaTemplateCorrespondencia: 'correspondencia_es' }
      expect(resolveWhatsAppProvider(env, 'correspondencia')).toBe('meta')
      expect(plantillaMeta(env, 'correspondencia')).toBe('correspondencia_es')
      expect(buildMetaWaPayload('50255551234', varsCorreo, 'correspondencia_es', 'es').template)
        .toMatchObject({ name: 'correspondencia_es' })
    })

    it('una plantilla en blanco cuenta como no configurada', () => {
      const env = { ...envMeta, metaTemplateCorrespondencia: '   ' }
      expect(resolveWhatsAppProvider(env, 'correspondencia')).toBeNull()
    })

    it('la plantilla de correspondencia no altera la de paquetería', () => {
      const env = { ...envMeta, metaTemplateCorrespondencia: 'correspondencia_es' }
      expect(plantillaMeta(env, 'paquete')).toBe('paquete_es')
    })
  })

  describe('Twilio', () => {
    it('paquetería conserva EXACTAMENTE el cuerpo anterior', () => {
      const body = buildTwilioWaParams('50255551234', varsPaquete, envTwilio.twilioFrom).Body
      expect(body).toBe('📦 Tienes Paquete en portería para A-3: Caja. Pasa a recogerlo cuando gustes.')
    })

    it('correspondencia usa su icono, su lugar y su cierre', () => {
      const body = buildTwilioWaParams('50255551234', varsCorreo, envTwilio.twilioFrom).Body
      expect(body).toBe('📬 Tienes Notificación legal en administración para A-3: Citación. Puedes retirarla presentando tu identificación.')
      expect(body).not.toContain('portería')
      expect(body).not.toContain('recogerlo')
    })

    it('sirve a las dos clases: no necesita plantilla aprobada', () => {
      expect(resolveWhatsAppProvider(envTwilio, 'paquete')).toBe('twilio')
      expect(resolveWhatsAppProvider(envTwilio, 'correspondencia')).toBe('twilio')
    })

    it('sin `clase` en vars se comporta como paquetería (compatibilidad)', () => {
      const body = buildTwilioWaParams('50255551234', { tipo_label: 'Paquete', descripcion: 'Caja', unidad: 'A-3' }, envTwilio.twilioFrom).Body
      expect(body).toContain('portería')
    })
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

// ── Entrada vs salida, impuesto en el SERVIDOR ──────────────────────────────
// El hallazgo: una pieza `direccion='saliente'` podía notificarse. El aviso
// entero está escrito desde "algo llegó para ti" — mandárselo al residente por
// lo que él mismo despachó es decirle que vaya a buscar lo que acaba de
// entregar. Que la pestaña ya no lo intente no basta: esta función es
// invocable con cualquier id por cualquiera con un JWT de la empresa.
describe('notify-package/esPiezaSaliente', () => {
  it('reconoce las dos formas de salir', () => {
    expect(esPiezaSaliente('saliente')).toBe(true)
    expect(esPiezaSaliente('saliente_tercero')).toBe(true)
  })

  it('entrante, vacío o ausente son entradas', () => {
    expect(esPiezaSaliente('entrante')).toBe(false)
    expect(esPiezaSaliente(null)).toBe(false)
    expect(esPiezaSaliente(undefined)).toBe(false)
  })
})

describe('notify-package/motivoOmision', () => {
  const entrante = {
    direccion: 'entrante', notificado_at: null,
    unidades: { nombre: 'A-3', cliente_id: 'cli-1' },
  }

  it('una ENTRADA a una unidad sí se avisa', () => {
    expect(motivoOmision(entrante)).toBeNull()
  })

  it('una SALIDA no se avisa', () => {
    expect(motivoOmision({ ...entrante, direccion: 'saliente' })).toBe('pieza_saliente')
    expect(motivoOmision({ ...entrante, direccion: 'saliente_tercero' })).toBe('pieza_saliente')
  })

  it('la salida gana incluso sobre la idempotencia', () => {
    // Importa el orden: una salida no debe ni sellarse como "ya notificada".
    expect(motivoOmision({ ...entrante, direccion: 'saliente', notificado_at: '2026-08-19T00:00:00Z' }))
      .toBe('pieza_saliente')
  })

  it('sigue respetando las dos razones que ya existían', () => {
    expect(motivoOmision({ ...entrante, notificado_at: '2026-08-19T00:00:00Z' })).toBe('already_notified')
    expect(motivoOmision({ ...entrante, unidades: null })).toBe('no_cliente')
    expect(motivoOmision({ ...entrante, unidades: { nombre: 'Admin', cliente_id: null } })).toBe('no_cliente')
  })
})

// Los tres canales se construyen igual para cualquier pieza: la decisión de
// NO avisar una salida se toma antes, en motivoOmision. Estas pruebas fijan
// las dos mitades de ese contrato — que la entrada produce los tres avisos con
// su texto, y que la salida ni llega a construirlos.
describe('notify-package/canales según la dirección', () => {
  const varsEntrante = {
    to_name: 'Ana', unidad: 'A-3', descripcion: 'Citación', tipo_label: 'Notificación legal',
    clase: 'correspondencia', empresa_nombre: 'Torre Norte', app_url: 'https://app',
  }
  const envTwilio: WhatsAppEnv = {
    provider: 'twilio', metaToken: '', metaPhoneId: '', metaTemplate: '',
    twilioSid: 'AC', twilioToken: 't', twilioFrom: 'whatsapp:+1',
  }

  it('ENTRADA: correo, in-app y WhatsApp salen con el texto de "te llegó algo"', () => {
    const pieza = { direccion: 'entrante', notificado_at: null, unidades: { cliente_id: 'cli-1' } }
    expect(motivoOmision(pieza)).toBeNull()

    const correo = renderPaquete(varsEntrante)
    expect(correo.subject).toContain('disponible en administración')
    expect(correo.html).toContain('Puedes retirarla en administración')

    const [inApp] = buildPaqueteInAppRows(['u1'], varsEntrante, { companyId: 'c1', paqueteId: 'p1' })
    expect(inApp.titulo).toBe('📬 Notificación legal en administración')
    expect(inApp.seccion).toBe('correspondencia')

    expect(resolveWhatsAppProvider(envTwilio, 'correspondencia')).toBe('twilio')
    expect(buildTwilioWaParams('50255551234', varsEntrante, 'whatsapp:+1').Body)
      .toBe('📬 Tienes Notificación legal en administración para A-3: Citación. Puedes retirarla presentando tu identificación.')
  })

  it('SALIDA: el handler corta antes, así que no se construye ningún canal', () => {
    const pieza = { direccion: 'saliente', notificado_at: null, unidades: { cliente_id: 'cli-1' } }
    expect(motivoOmision(pieza)).toBe('pieza_saliente')
  })

  it('SALIDA de paquetería (retiro por tercero): mismo corte', () => {
    const pieza = { direccion: 'saliente_tercero', notificado_at: null, unidades: { cliente_id: 'cli-1' } }
    expect(motivoOmision(pieza)).toBe('pieza_saliente')
  })
})

// ── RBAC del aviso ──────────────────────────────────────────────────────────
// El hallazgo: la función corre con service_role —que salta la RLS entera— y
// solo comparaba `company_id`. Cualquier usuario del tenant con un JWT válido
// podía enumerar ids y provocar correo, WhatsApp y notificación in-app por
// correspondencia que no le compete.
describe('notify-package/puedeNotificar', () => {
  const CORR = { company_id: 'emp', project_id: 'proy', clase: 'correspondencia' }
  const PAQ  = { company_id: 'emp', project_id: 'proy', clase: 'paquete' }

  function perfil(over: Partial<PerfilLlamante> = {}): PerfilLlamante {
    return { role: 'operator', companyId: 'emp', permisos: [], proyectos: ['proy'], ...over }
  }
  const jwt = (p: PerfilLlamante) => ({ internal: false, perfil: p })

  const OP_PAQ  = perfil({ permisos: ['condominios.tab.paqueteria'] })
  const OP_CORR = perfil({ permisos: ['condominios.tab.correspondencia'] })

  it('el operador de paquetería NO notifica correspondencia', () => {
    expect(puedeNotificar(jwt(OP_PAQ), CORR)).toEqual({ ok: false, motivo: 'sin_permiso_de_clase' })
  })

  it('el operador de correspondencia NO notifica paquetes', () => {
    expect(puedeNotificar(jwt(OP_CORR), PAQ)).toEqual({ ok: false, motivo: 'sin_permiso_de_clase' })
  })

  it('CONTROL POSITIVO: cada uno sí notifica lo suyo', () => {
    expect(puedeNotificar(jwt(OP_PAQ), PAQ)).toEqual({ ok: true })
    expect(puedeNotificar(jwt(OP_CORR), CORR)).toEqual({ ok: true })
  })

  it('mismo permiso pero proyecto NO asignado: rechazado', () => {
    const otraTorre = perfil({ permisos: ['condominios.tab.correspondencia'], proyectos: ['otra-torre'] })
    expect(puedeNotificar(jwt(otraTorre), CORR)).toEqual({ ok: false, motivo: 'proyecto_no_asignado' })
  })

  it('otra empresa: rechazado antes de mirar nada más', () => {
    const ajeno = perfil({ role: 'admin', companyId: 'otra' })
    expect(puedeNotificar(jwt(ajeno), CORR)).toEqual({ ok: false, motivo: 'otra_empresa' })
  })

  it('admin y company_owner de la empresa sí pasan', () => {
    expect(puedeNotificar(jwt(perfil({ role: 'admin', proyectos: [] })), CORR)).toEqual({ ok: true })
    expect(puedeNotificar(jwt(perfil({ role: 'company_owner', proyectos: [] })), CORR)).toEqual({ ok: true })
  })

  it('un admin CON asignaciones ya no es exento de proyecto', () => {
    // Espeja user_is_project_exempt (20260815000000): el admin ve todo mientras
    // no tenga asignaciones explícitas; en cuanto las tiene, se acota a ellas.
    const admin = perfil({ role: 'admin', proyectos: ['otra-torre'] })
    expect(puedeNotificar(jwt(admin), CORR)).toEqual({ ok: false, motivo: 'proyecto_no_asignado' })
  })

  it('super_admin pasa aunque sea de otra empresa (soporte)', () => {
    expect(puedeNotificar(jwt(perfil({ role: 'super_admin', companyId: 'otra' })), CORR)).toEqual({ ok: true })
  })

  it('la llamada interna con la service key pasa sin perfil', () => {
    expect(puedeNotificar({ internal: true, perfil: null }, CORR)).toEqual({ ok: true })
  })

  it('sin perfil y sin ser interna, no pasa', () => {
    expect(puedeNotificar({ internal: false, perfil: null }, CORR)).toEqual({ ok: false, motivo: 'sin_perfil' })
  })

  it('una pieza sin empresa no autoriza a nadie', () => {
    expect(puedeNotificar(jwt(OP_CORR), { ...CORR, company_id: null }))
      .toEqual({ ok: false, motivo: 'otra_empresa' })
  })
})

describe('notify-package/helpers de RBAC', () => {
  it('la clave de permiso la decide la clase', () => {
    expect(permisoDeClase('correspondencia')).toBe('condominios.tab.correspondencia')
    expect(permisoDeClase('paquete')).toBe('condominios.tab.paqueteria')
    expect(permisoDeClase(null)).toBe('condominios.tab.paqueteria')
  })

  it('tienePermiso espeja el helper de la base (admin dice true a todo)', () => {
    const admin = { role: 'admin', companyId: 'e', permisos: [], proyectos: [] }
    expect(tienePermiso(admin, 'lo.que.sea')).toBe(true)
    const granular = { role: 'operator', companyId: 'e', permisos: ['a'], proyectos: [] }
    expect(tienePermiso(granular, 'a')).toBe(true)
    expect(tienePermiso(granular, 'b')).toBe(false)
  })

  it('accedeAlProyecto: una fila sin proyecto sellado es ambigua, no ajena', () => {
    const granular = { role: 'operator', companyId: 'e', permisos: [], proyectos: [] }
    expect(accedeAlProyecto(granular, null)).toBe(true)
    expect(accedeAlProyecto(granular, 'p1')).toBe(false)
    expect(accedeAlProyecto({ ...granular, proyectos: ['p1'] }, 'p1')).toBe(true)
  })
})
