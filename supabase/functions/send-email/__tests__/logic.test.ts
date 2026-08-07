// Tests de la lógica pura de send-email (infra:I22 · Track T8/T5). Como el resto
// de tests de edge fns, corre bajo vitest (no Deno) tratando el módulo como TS
// normal. Cubre: construcción del mensaje MIME/base64url para Gmail, headers
// RFC 2047, sanitización anti-inyección de HTML/URLs en las vars, plantillas
// integradas, el gate de autorización del scope de envío (anti open-relay /
// suplantación de tenant) y la ventana de refresh del token OAuth.

import { describe, it, expect } from 'vitest'
import {
  EMAIL_SENDER_ROLES,
  TOKEN_REFRESH_WINDOW_MS,
  applyVars,
  buildRawMessage,
  escapeHtml,
  formatFromHeader,
  isTokenExpired,
  renderTemplate,
  resolveEmailScope,
  sanitizeUrl,
  sanitizeVars,
} from '../logic.ts'

// Decodifica el base64url (con padding restaurado) a texto UTF-8 — inverso
// exacto del btoa(unescape(encodeURIComponent(...))) del módulo.
function fromBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  return decodeURIComponent(escape(atob(padded)))
}

function fromBase64(b64: string): string {
  return decodeURIComponent(escape(atob(b64)))
}

describe('send-email/formatFromHeader', () => {
  it('sin display name devuelve el email pelado', () => {
    expect(formatFromHeader('noreply@admin.com', null)).toBe('noreply@admin.com')
  })

  it('con display name lo codifica RFC 2047 (base64 UTF-8) y conserva el email', () => {
    const h = formatFromHeader('noreply@admin.com', 'Administración')
    const m = h.match(/^"=\?UTF-8\?B\?(.+)\?=" <noreply@admin\.com>$/)
    expect(m).not.toBeNull()
    expect(fromBase64(m![1])).toBe('Administración')
  })
})

describe('send-email/buildRawMessage', () => {
  // Guarda del PR-15. `To` es la única cabecera que no va codificada en base64,
  // así que es la única por la que se puede inyectar. La versión original de
  // este helper metía el destinatario en crudo; si alguien vuelve a extraerlo
  // sin el guard, un `\r\nBcc:` mandaría copia a un tercero en silencio.
  it('rechaza inyección de cabeceras por el destinatario (CRLF)', () => {
    expect(() => buildRawMessage(
      'a@b.com', null, null, 'victima@x.com\r\nBcc: atacante@evil.com', 'S', '<p>x</p>', NONCE,
    )).toThrow()
  })

  it('rechaza inyección por Reply-To', () => {
    expect(() => buildRawMessage(
      'a@b.com', null, 'ok@x.com\nCc: atacante@evil.com', 'c@d.com', 'S', '<p>x</p>', NONCE,
    )).toThrow()
  })

  const NONCE = 1234567890

  it('produce base64url puro (sin + / = , apto para la Gmail API)', () => {
    const raw = buildRawMessage('a@b.com', 'Ñandú & Cía', 'reply@b.com', 'c@d.com', 'Recibo — junio', '<p>Sí</p>', NONCE)
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('arma los headers MIME en orden con el boundary inyectado', () => {
    const raw = buildRawMessage('a@b.com', null, null, 'c@d.com', 'Hola', '<p>hi</p>', NONCE)
    const mime = fromBase64Url(raw)
    const lines = mime.split('\r\n')
    expect(lines[0]).toBe('From: a@b.com')
    expect(lines[1]).toBe('To: c@d.com')
    expect(lines[2]).toMatch(/^Subject: =\?UTF-8\?B\?/)
    expect(lines[3]).toBe('MIME-Version: 1.0')
    expect(lines[4]).toBe(`Content-Type: multipart/alternative; boundary="----=_Part_${NONCE}"`)
    expect(mime).toContain(`--${'----=_Part_' + NONCE}`)
    expect(mime.endsWith(`--${'----=_Part_' + NONCE}--`)).toBe(true)
  })

  it('incluye Reply-To solo cuando hay reply_to configurado', () => {
    const con = fromBase64Url(buildRawMessage('a@b.com', null, 'r@b.com', 'c@d.com', 's', 'x', NONCE))
    const sin = fromBase64Url(buildRawMessage('a@b.com', null, null, 'c@d.com', 's', 'x', NONCE))
    expect(con).toContain('Reply-To: r@b.com')
    expect(sin).not.toContain('Reply-To:')
  })

  it('el asunto con acentos sobrevive el round-trip RFC 2047', () => {
    const mime = fromBase64Url(buildRawMessage('a@b.com', null, null, 'c@d.com', 'Recibo — Añó 2026 ✅', 'x', NONCE))
    const m = mime.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)
    expect(m).not.toBeNull()
    expect(fromBase64(m![1])).toBe('Recibo — Añó 2026 ✅')
  })

  it('el cuerpo HTML UTF-8 va como parte base64 y sobrevive el round-trip', () => {
    const html = '<p>Consumo: 12 m³ — Señor Pérez</p>'
    const mime = fromBase64Url(buildRawMessage('a@b.com', null, null, 'c@d.com', 's', html, NONCE))
    // La parte del cuerpo es la línea base64 entre el header vacío y el cierre.
    const bodyPart = mime.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n')[0]
    expect(fromBase64(bodyPart)).toBe(html)
  })
})

describe('send-email/escapeHtml y sanitizeUrl', () => {
  it('escapa los 5 caracteres peligrosos', () => {
    expect(escapeHtml(`<img src="x" onerror='a' & co>`)).toBe(
      '&lt;img src=&quot;x&quot; onerror=&#39;a&#39; &amp; co&gt;'
    )
  })

  it('sanitizeUrl permite http(s) y mailto (case-insensitive, con trim)', () => {
    expect(sanitizeUrl('https://app.com/reset')).toBe('https://app.com/reset')
    expect(sanitizeUrl('  HTTPS://app.com  ')).toBe('HTTPS://app.com')
    expect(sanitizeUrl('mailto:soporte@app.com')).toBe('mailto:soporte@app.com')
  })

  it('sanitizeUrl neutraliza javascript:/data:/relativos a "#"', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('#')
    expect(sanitizeUrl('data:text/html,<script>')).toBe('#')
    expect(sanitizeUrl('//evil.com')).toBe('#')
    expect(sanitizeUrl('')).toBe('#')
  })
})

describe('send-email/sanitizeVars', () => {
  it('escapa HTML en vars normales (anti inyección en el cuerpo)', () => {
    const out = sanitizeVars({ nombre_cliente: '<b>Juan</b> & Cía' })
    expect(out.nombre_cliente).toBe('&lt;b&gt;Juan&lt;/b&gt; &amp; Cía')
  })

  it('valida esquema en claves de URL (_link/_url/logo) antes de escapar', () => {
    const out = sanitizeVars({
      reset_link: 'javascript:alert(1)',
      cta_url: 'https://app.com/x?a=1&b=2',
      empresa_logo: 'data:image/svg+xml,<svg/>',
      logo: 'https://cdn.app.com/l.png',
    })
    expect(out.reset_link).toBe('#')
    expect(out.cta_url).toBe('https://app.com/x?a=1&amp;b=2') // válida, pero escapada para HTML
    expect(out.empresa_logo).toBe('#')
    expect(out.logo).toBe('https://cdn.app.com/l.png')
  })

  it('valores null/undefined se vuelven cadena vacía', () => {
    const out = sanitizeVars({ a: null, b: undefined } as unknown as Record<string, string>)
    expect(out.a).toBe('')
    expect(out.b).toBe('')
  })
})

describe('send-email/applyVars', () => {
  it('sustituye {{var}} y deja vacío lo que falta', () => {
    expect(applyVars('Hola {{nombre}}, saldo {{saldo}}', { nombre: 'Ana' })).toBe('Hola Ana, saldo ')
  })
})

describe('send-email/renderTemplate', () => {
  it('template desconocido devuelve null (el handler responde 400)', () => {
    expect(renderTemplate('no_existe', {})).toBeNull()
  })

  it('recibo: asunto con mes/empresa y cuerpo con lecturas y total', () => {
    const r = renderTemplate('recibo', {
      empresa_nombre: 'Mayan', mes: 'Junio 2026',
      lectura_anterior: '10', lectura_actual: '22', consumo: '12',
      moneda: 'Q', total_pagar: '150.00', fecha: '01/07/2026',
    })!
    expect(r.subject).toBe('Recibo de Consumo — Junio 2026 | Mayan')
    expect(r.html).toContain('10')
    expect(r.html).toContain('22')
    expect(r.html).toContain('Q150.00')
  })

  it('recibo sin mes omite el separador del asunto', () => {
    const r = renderTemplate('recibo', { empresa_nombre: 'Mayan' })!
    expect(r.subject).toBe('Recibo de Consumo | Mayan')
  })

  it('difusion: usa vars.subject o cae al comunicado genérico', () => {
    expect(renderTemplate('difusion', { subject: 'Corte de agua', empresa_nombre: 'Mayan' })!.subject)
      .toBe('Corte de agua')
    expect(renderTemplate('difusion', { empresa_nombre: 'Mayan' })!.subject)
      .toBe('Comunicado de Mayan')
  })

  it('password_reset: incluye el reset_link (y "#" si falta)', () => {
    expect(renderTemplate('password_reset', { reset_link: 'https://app.com/r?t=1' })!.html)
      .toContain('https://app.com/r?t=1')
    expect(renderTemplate('password_reset', {})!.html).toContain('href="#"')
  })

  it('bienvenida_empresa: platform_name cae a "AquaControl"', () => {
    expect(renderTemplate('bienvenida_empresa', { empresa_nombre: 'Mayan' })!.subject)
      .toBe('¡Bienvenido a AquaControl! | Mayan')
  })

  it('sin empresa_nombre cae a "Control de Consumo de Agua"', () => {
    expect(renderTemplate('recibo', {})!.subject).toContain('| Control de Consumo de Agua')
  })
})

describe('send-email/resolveEmailScope (anti open-relay / suplantación)', () => {
  it('is_superadmin=true exige rol super (en ambas variantes)', () => {
    for (const role of ['super_admin', 'superadmin']) {
      const r = resolveEmailScope({ isSuperadmin: true, companyId: null }, { role, companyId: null })
      expect(r).toEqual({ ok: true, isSuperadmin: true, companyId: null })
    }
  })

  it('NUNCA deja a un no-super enviar correo de plataforma (escalada)', () => {
    for (const role of ['admin', 'company_owner', 'operator', 'viewer', '']) {
      const r = resolveEmailScope({ isSuperadmin: true, companyId: null }, { role, companyId: 'emp-1' })
      expect(r).toEqual({ ok: false, error: 'Solo un super administrador puede enviar correo de plataforma' })
    }
  })

  it('staff de tenant queda SIEMPRE acotado a su propia empresa (ignora el company_id del body)', () => {
    const r = resolveEmailScope(
      { isSuperadmin: false, companyId: 'empresa-ajena' },
      { role: 'admin', companyId: 'mi-empresa' },
    )
    expect(r).toEqual({ ok: true, isSuperadmin: false, companyId: 'mi-empresa' })
  })

  it('roles sin permiso de envío (viewer/visor/collector/desconocido) → 403', () => {
    for (const role of ['viewer', 'visor', 'collector', 'residente', '']) {
      const r = resolveEmailScope({ isSuperadmin: false, companyId: 'emp-1' }, { role, companyId: 'emp-1' })
      expect(r).toEqual({ ok: false, error: 'No autorizado para enviar correo' })
    }
  })

  it('staff con rol válido pero sin empresa asociada → 403', () => {
    const r = resolveEmailScope({ isSuperadmin: false, companyId: 'emp-1' }, { role: 'admin', companyId: null })
    expect(r).toEqual({ ok: false, error: 'No autorizado para enviar correo' })
  })

  it('super_admin con is_superadmin=false envía a nombre del company_id pedido', () => {
    const r = resolveEmailScope(
      { isSuperadmin: false, companyId: 'emp-2' },
      { role: 'super_admin', companyId: null },
    )
    expect(r).toEqual({ ok: true, isSuperadmin: false, companyId: 'emp-2' })
  })

  it('el whitelist de roles remitentes coincide con la constante exportada', () => {
    expect(EMAIL_SENDER_ROLES).toEqual(['admin', 'company_owner', 'operator', 'operador'])
  })
})

describe('send-email/isTokenExpired', () => {
  const now = Date.parse('2026-07-01T12:00:00.000Z')

  it('sin expiry (null) → no expirado', () => {
    expect(isTokenExpired(null, now)).toBe(false)
  })

  it('con más de 5 min de vida → no expirado; con menos → expirado (refresh)', () => {
    expect(isTokenExpired(new Date(now + TOKEN_REFRESH_WINDOW_MS + 1).toISOString(), now)).toBe(false)
    expect(isTokenExpired(new Date(now + 60 * 1000).toISOString(), now)).toBe(true)
    expect(isTokenExpired(new Date(now - 1000).toISOString(), now)).toBe(true)
  })

  it('frontera: exactamente 5 min de vida NO dispara refresh (comparación estricta <)', () => {
    expect(isTokenExpired(new Date(now + TOKEN_REFRESH_WINDOW_MS).toISOString(), now)).toBe(false)
  })
})
