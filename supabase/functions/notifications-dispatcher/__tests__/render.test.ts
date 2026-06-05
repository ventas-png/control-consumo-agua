// Tests de la lógica pura del dispatcher (infra:I22 · Track T8). Corre bajo vitest
// tratando el módulo como TS normal. Cubre lo de mayor valor del orquestador:
//   - resolución de plantilla de email EN CASCADA (notif tenant→global → email_tpl
//     → payload) y reglas post-cascada (subject por defecto, wrap en layout).
//   - routing de canal (in_app/email soportados; whatsapp/push/desconocido → error).
//   - sustitución de variables {{...}}, expiración de token Gmail, clasificación
//     retriable de status HTTP y clamp del batch.

import { describe, it, expect } from 'vitest'
import {
  applyVars,
  asString,
  buildDispatchEvent,
  clampBatchSize,
  emailLayout,
  formatFromHeader,
  isGmailStatusRetriable,
  isTokenExpired,
  looksLikeFullHtml,
  resolveEmailContent,
  routeChannel,
  type EmailContentInputs,
} from '../render.ts'

describe('dispatcher/asString', () => {
  it('coacciona null/undefined a cadena vacía', () => {
    expect(asString(null)).toBe('')
    expect(asString(undefined)).toBe('')
  })

  it('pasa strings tal cual y stringifica el resto', () => {
    expect(asString('hola')).toBe('hola')
    expect(asString(42)).toBe('42')
    expect(asString(true)).toBe('true')
  })
})

describe('dispatcher/applyVars', () => {
  it('sustituye {{var}} desde el payload', () => {
    expect(applyVars('Hola {{nombre}}', { nombre: 'Ana' })).toBe('Hola Ana')
  })

  it('variables ausentes → cadena vacía (no deja el literal {{x}})', () => {
    expect(applyVars('A{{falta}}B', {})).toBe('AB')
  })

  it('coacciona valores no-string', () => {
    expect(applyVars('n={{n}}', { n: 7 })).toBe('n=7')
  })

  it('múltiples ocurrencias de la misma var', () => {
    expect(applyVars('{{x}}-{{x}}', { x: 'z' })).toBe('z-z')
  })
})

describe('dispatcher/looksLikeFullHtml', () => {
  it('detecta documentos HTML completos', () => {
    expect(looksLikeFullHtml('<html><body>x</body></html>')).toBe(true)
    expect(looksLikeFullHtml('<table>...')).toBe(true)
    expect(looksLikeFullHtml('<BODY>')).toBe(true) // case-insensitive
  })

  it('texto plano / fragmentos no se consideran HTML completo', () => {
    expect(looksLikeFullHtml('Hola mundo')).toBe(false)
    expect(looksLikeFullHtml('<p>solo un parrafo</p>')).toBe(false)
  })
})

describe('dispatcher/formatFromHeader', () => {
  it('sin nombre → solo el email', () => {
    expect(formatFromHeader('a@b.com', null)).toBe('a@b.com')
  })

  it('con nombre → display name RFC 2047 (base64 UTF-8) + <email>', () => {
    const h = formatFromHeader('a@b.com', 'Acme')
    expect(h).toBe(`"=?UTF-8?B?${btoa('Acme')}?=" <a@b.com>`)
  })

  it('codifica nombres con acentos sin romper el header', () => {
    const h = formatFromHeader('a@b.com', 'Mayán Residenciales')
    expect(h).toMatch(/^"=\?UTF-8\?B\?.+\?=" <a@b\.com>$/)
  })
})

describe('dispatcher/emailLayout', () => {
  it('envuelve el contenido e inyecta el nombre de empresa', () => {
    const html = emailLayout('CUERPO', 'Acme')
    expect(html).toContain('CUERPO')
    expect(html).toContain('Acme')
    expect(html).toMatch(/<!DOCTYPE html>/i)
  })
})

// ── Cascada de resolución de email — el corazón del dispatcher ───────────────
describe('dispatcher/resolveEmailContent (cascada)', () => {
  const base: EmailContentInputs = {
    payloadSubject: '',
    payloadHtmlBody: '',
    empresaNombre: 'Acme',
    vars: { nombre: 'Ana' },
    notifTpl: null,
    emailTpl: null,
  }

  it('1) notification_templates GANA sobre email_templates y payload', () => {
    const r = resolveEmailContent({
      ...base,
      payloadSubject: 'PAYLOAD SUBJ',
      payloadHtmlBody: 'payload body',
      notifTpl: { subject: 'Hola {{nombre}}', body: 'Cuerpo {{nombre}}' },
      emailTpl: { subject: 'EMAIL TPL', html_body: '<html>tpl</html>' },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.subject).toBe('Hola Ana')
    // El body de notif se envuelve SIEMPRE en el layout estándar.
    expect(r.htmlBody).toContain('Cuerpo Ana')
    expect(r.htmlBody).toMatch(/<!DOCTYPE html>/i)
    expect(r.htmlBody).not.toContain('payload body')
    expect(r.htmlBody).not.toContain('tpl')
  })

  it('notif sin subject → usa el subject del payload (renderizado)', () => {
    const r = resolveEmailContent({
      ...base,
      payloadSubject: 'Para {{nombre}}',
      notifTpl: { subject: null, body: 'cuerpo' },
    })
    expect(r.ok && r.subject).toBe('Para Ana')
  })

  it('2) email_templates se usa SOLO si no hay notif (override HTML, sin layout)', () => {
    const r = resolveEmailContent({
      ...base,
      payloadHtmlBody: 'payload body',
      emailTpl: { subject: 'Asunto {{nombre}}', html_body: '<html><body>{{nombre}}</body></html>' },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.subject).toBe('Asunto Ana')
    // html_body ya es HTML completo → NO se re-envuelve en layout.
    expect(r.htmlBody).toBe('<html><body>Ana</body></html>')
  })

  it('3) payload directo (html_body) cuando no hay plantillas', () => {
    const r = resolveEmailContent({
      ...base,
      payloadSubject: 'Asunto directo',
      payloadHtmlBody: '<html><body>directo</body></html>',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.subject).toBe('Asunto directo')
    expect(r.htmlBody).toBe('<html><body>directo</body></html>')
  })

  it('payload body NO-HTML se envuelve en el layout estándar', () => {
    const r = resolveEmailContent({ ...base, payloadHtmlBody: 'solo texto' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.htmlBody).toContain('solo texto')
    expect(r.htmlBody).toMatch(/<!DOCTYPE html>/i)
  })

  it('sin subject resoluble → "Notificación de <empresa>"', () => {
    const r = resolveEmailContent({ ...base, payloadHtmlBody: '<html>x</html>' })
    expect(r.ok && r.subject).toBe('Notificación de Acme')
  })

  it('sin body ni plantilla → error NO-retriable', () => {
    const r = resolveEmailContent({ ...base })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/sin body ni plantilla/)
  })
})

describe('dispatcher/routeChannel', () => {
  it('in_app y email son soportados', () => {
    expect(routeChannel('in_app')).toEqual({ supported: true })
    expect(routeChannel('email')).toEqual({ supported: true })
  })

  it('whatsapp y push: no soportados (follow-up) con mensaje', () => {
    expect(routeChannel('whatsapp')).toMatchObject({ supported: false })
    expect(routeChannel('whatsapp').error).toMatch(/whatsapp no implementado/)
    expect(routeChannel('push').error).toMatch(/push no implementado/)
  })

  it('canal desconocido → no soportado, error nombra el canal', () => {
    const r = routeChannel('telepatia')
    expect(r.supported).toBe(false)
    expect(r.error).toBe('canal desconocido: telepatia')
  })
})

describe('dispatcher/isTokenExpired', () => {
  const now = Date.parse('2026-06-04T12:00:00.000Z')

  it('null/sin expiry → no expirado', () => {
    expect(isTokenExpired(null, now)).toBe(false)
  })

  it('expirado si quedan menos de 5 min de vida', () => {
    const in4min = new Date(now + 4 * 60 * 1000).toISOString()
    expect(isTokenExpired(in4min, now)).toBe(true)
  })

  it('vigente si quedan más de 5 min', () => {
    const in10min = new Date(now + 10 * 60 * 1000).toISOString()
    expect(isTokenExpired(in10min, now)).toBe(false)
  })

  it('ya vencido en el pasado → expirado', () => {
    const past = new Date(now - 60 * 1000).toISOString()
    expect(isTokenExpired(past, now)).toBe(true)
  })
})

describe('dispatcher/isGmailStatusRetriable', () => {
  it('429 (quota) es retriable', () => {
    expect(isGmailStatusRetriable(429)).toBe(true)
  })

  it('5xx son retriables', () => {
    expect(isGmailStatusRetriable(500)).toBe(true)
    expect(isGmailStatusRetriable(503)).toBe(true)
  })

  it('4xx (salvo 429) son terminales', () => {
    expect(isGmailStatusRetriable(400)).toBe(false)
    expect(isGmailStatusRetriable(401)).toBe(false)
    expect(isGmailStatusRetriable(403)).toBe(false)
    expect(isGmailStatusRetriable(404)).toBe(false)
  })
})

describe('dispatcher/clampBatchSize', () => {
  const bounds = { def: 50, max: 200 }

  it('usa el default cuando no es un número válido', () => {
    expect(clampBatchSize(undefined, bounds)).toBe(50)
    expect(clampBatchSize('no-num', bounds)).toBe(50)
    expect(clampBatchSize(0, bounds)).toBe(50) // 0 || def → def
  })

  it('respeta valores dentro de rango', () => {
    expect(clampBatchSize(10, bounds)).toBe(10)
    expect(clampBatchSize(200, bounds)).toBe(200)
  })

  it('acota por arriba al máximo y por abajo a 1', () => {
    expect(clampBatchSize(9999, bounds)).toBe(200)
    expect(clampBatchSize(-5, bounds)).toBe(1)
  })
})

describe('dispatcher/buildDispatchEvent', () => {
  const ctx = { channel: 'email', attempts: 0, maxAttempts: 5 }

  it('ok → evento sent con el canal', () => {
    expect(buildDispatchEvent({ ok: true }, ctx)).toEqual({
      eventType: 'sent',
      detail: { channel: 'email' },
    })
  })

  it('fallo retriable con intentos restantes → failed, terminal=false', () => {
    const ev = buildDispatchEvent({ ok: false, error: 'Gmail 503', retriable: true }, ctx)
    expect(ev.eventType).toBe('failed')
    expect(ev.detail).toEqual({
      channel: 'email',
      error: 'Gmail 503',
      retriable: true,
      terminal: false,
      attempt: 1,
    })
  })

  it('fallo no-retriable → failed, terminal=true aunque queden intentos', () => {
    const ev = buildDispatchEvent({ ok: false, error: 'token revocado', retriable: false }, ctx)
    expect(ev.detail.terminal).toBe(true)
    expect(ev.detail.retriable).toBe(false)
  })

  it('último intento (attempts+1 >= max) → terminal=true aunque sea retriable', () => {
    const ev = buildDispatchEvent(
      { ok: false, error: 'Gmail 503', retriable: true },
      { channel: 'email', attempts: 4, maxAttempts: 5 },
    )
    expect(ev.detail.terminal).toBe(true)
    expect(ev.detail.attempt).toBe(5)
  })

  it('retriable ausente → default true; error ausente → null', () => {
    const ev = buildDispatchEvent({ ok: false }, ctx)
    expect(ev.detail.retriable).toBe(true)
    expect(ev.detail.error).toBeNull()
  })
})
