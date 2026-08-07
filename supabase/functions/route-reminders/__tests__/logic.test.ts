// Tests de la lógica pura de route-reminders (infra:I22 · Track T8). Como el
// resto de tests de edge fns, corre bajo vitest (no Deno) tratando el módulo
// como TS normal. Cubre: fechas/ventanas en hora Guatemala (UTC-6), vencimiento
// del recordatorio (isDue), conteo de ítems por tipo de ruta, dedupe de
// destinatarios (primero gana), gate de autorización por empresa, variables y
// render de la plantilla, rows in-app y mensaje MIME base64url para Gmail.

import { describe, it, expect } from 'vitest'
import {
  GT_OFFSET_MS,
  type Recipient,
  applyVars,
  autorizadoParaEmpresa,
  batchHorizonDate,
  buildInAppRows,
  buildRawMessage,
  buildReminderVars,
  dedupeRecipients,
  fmtFecha,
  hhmm,
  isDue,
  itemInfo,
  renderRecordatorio,
  todayGT,
} from '../logic.ts'

describe('route-reminders/todayGT', () => {
  it('resta 6 horas fijas (Guatemala no tiene DST)', () => {
    expect(GT_OFFSET_MS).toBe(6 * 60 * 60 * 1000)
    // 03:00 UTC del día 10 aún es día 9 en Guatemala (21:00 GT).
    expect(todayGT(Date.parse('2026-07-10T03:00:00Z'))).toBe('2026-07-09')
    // 06:00 UTC ya es medianoche GT del día 10.
    expect(todayGT(Date.parse('2026-07-10T06:00:00Z'))).toBe('2026-07-10')
  })
})

describe('route-reminders/batchHorizonDate', () => {
  it('horizonte = hoy GT + 2 días (ventana del query batch)', () => {
    const now = Date.parse('2026-07-09T18:00:00Z') // 12:00 GT del 9
    expect(batchHorizonDate(now)).toBe('2026-07-11')
  })

  it('cruza el mes correctamente', () => {
    const now = Date.parse('2026-07-31T18:00:00Z')
    expect(batchHorizonDate(now)).toBe('2026-08-02')
  })
})

describe('route-reminders/fmtFecha y hhmm', () => {
  it('convierte YYYY-MM-DD a DD/MM/YYYY', () => {
    expect(fmtFecha('2026-07-09')).toBe('09/07/2026')
  })

  it('recorta HH:MM:SS a HH:MM y tolera null/undefined', () => {
    expect(hhmm('08:30:00')).toBe('08:30')
    expect(hhmm('08:30')).toBe('08:30')
    expect(hhmm(null)).toBe('')
    expect(hhmm(undefined)).toBe('')
  })
})

describe('route-reminders/isDue (ventana de envío)', () => {
  const route = { hora_programada: null, recordatorio_anticipacion_min: 1440 }

  it('aún NO vence si falta más que la anticipación', () => {
    // Ocurrencia el 10 a las 08:00 GT (= 14:00 UTC); anticipación 1 día →
    // se vuelve due el 9 a las 14:00 UTC. Un minuto antes: no due.
    const occ = { fecha: '2026-07-10', hora: '08:00:00' }
    expect(isDue(occ, route, Date.parse('2026-07-09T13:59:00Z'))).toBe(false)
  })

  it('vence exactamente al entrar en la ventana (now >= instante - anticipación)', () => {
    const occ = { fecha: '2026-07-10', hora: '08:00:00' }
    expect(isDue(occ, route, Date.parse('2026-07-09T14:00:00Z'))).toBe(true)
    expect(isDue(occ, route, Date.parse('2026-07-09T15:00:00Z'))).toBe(true)
  })

  it('sin hora de ocurrencia usa la de la ruta; sin ninguna, 08:00 GT', () => {
    // hora de la ruta 10:00 GT → 16:00 UTC; anticipación 60 min.
    const r = { hora_programada: '10:00:00', recordatorio_anticipacion_min: 60 }
    const occ = { fecha: '2026-07-10', hora: null }
    expect(isDue(occ, r, Date.parse('2026-07-10T14:59:00Z'))).toBe(false)
    expect(isDue(occ, r, Date.parse('2026-07-10T15:00:00Z'))).toBe(true)
    // Default absoluto: 08:00 GT (14:00 UTC) con anticipación default 1440 min.
    const occ2 = { fecha: '2026-07-10', hora: null }
    expect(isDue(occ2, {}, Date.parse('2026-07-09T14:00:00Z'))).toBe(true)
    expect(isDue(occ2, {}, Date.parse('2026-07-09T13:59:00Z'))).toBe(false)
  })

  it('fecha imparseable → true (mejor recordar de más que perder el aviso)', () => {
    expect(isDue({ fecha: 'no-es-fecha', hora: null }, route, Date.now())).toBe(true)
  })
})

describe('route-reminders/itemInfo', () => {
  it('cuenta según tipo_ruta y cae a clientes por defecto', () => {
    expect(itemInfo({ tipo_ruta: 'contadores', contador_ids: ['a', 'b'] })).toEqual({ total: 2, tipo: 'contadores' })
    expect(itemInfo({ tipo_ruta: 'unidades', unidad_ids: ['u1'] })).toEqual({ total: 1, tipo: 'unidades' })
    expect(itemInfo({ tipo_ruta: 'clientes', cliente_ids: ['c1', 'c2', 'c3'] })).toEqual({ total: 3, tipo: 'clientes' })
    expect(itemInfo({ cliente_ids: ['c1'] })).toEqual({ total: 1, tipo: 'clientes' })
  })

  it('arrays ausentes cuentan 0 (no revienta)', () => {
    expect(itemInfo({ tipo_ruta: 'contadores' })).toEqual({ total: 0, tipo: 'contadores' })
    expect(itemInfo({})).toEqual({ total: 0, tipo: 'clientes' })
  })
})

describe('route-reminders/dedupeRecipients (agrupación por destinatario)', () => {
  const op = (userId: string | null, email: string | null): Recipient => ({ userId, email, rol: 'operador' })
  const adm = (userId: string | null, email: string | null): Recipient => ({ userId, email, rol: 'administrador' })

  it('el operador asignado gana sobre el admin con el mismo userId (primero gana)', () => {
    const out = dedupeRecipients([op('u1', 'op@x.com'), adm('u1', 'op@x.com'), adm('u2', 'a@x.com')])
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual(op('u1', 'op@x.com')) // conserva rol operador
    expect(out[1]).toEqual(adm('u2', 'a@x.com'))
  })

  it('sin userId dedupea por email', () => {
    const out = dedupeRecipients([op(null, 'x@x.com'), adm(null, 'x@x.com')])
    expect(out).toHaveLength(1)
    expect(out[0].rol).toBe('operador')
  })

  it('descarta entradas sin userId ni email', () => {
    expect(dedupeRecipients([op(null, null), adm('u1', null)])).toEqual([adm('u1', null)])
  })
})

describe('route-reminders/autorizadoParaEmpresa (gate por tenant)', () => {
  it('interno (service key) y super_admin pasan siempre', () => {
    expect(autorizadoParaEmpresa({ internal: true, callerIsSuperAdmin: false, callerCompanyId: null }, 'c1')).toBe(true)
    expect(autorizadoParaEmpresa({ internal: false, callerIsSuperAdmin: true, callerCompanyId: 'otra' }, 'c1')).toBe(true)
  })

  it('admin/owner solo puede enviar para SU empresa (no cross-tenant)', () => {
    expect(autorizadoParaEmpresa({ internal: false, callerIsSuperAdmin: false, callerCompanyId: 'c1' }, 'c1')).toBe(true)
    expect(autorizadoParaEmpresa({ internal: false, callerIsSuperAdmin: false, callerCompanyId: 'c1' }, 'c2')).toBe(false)
  })
})

describe('route-reminders/applyVars', () => {
  it('sustituye {{var}} y deja vacío lo desconocido', () => {
    expect(applyVars('Hola {{nombre}} ({{rol}})', { nombre: 'Ana' })).toBe('Hola Ana ()')
  })
})

describe('route-reminders/buildReminderVars', () => {
  const ctx = { fechaFmt: '09/07/2026', horaFmt: '08:00', total: 5, tipo: 'contadores', empresaNombre: 'Mayan', appUrl: 'https://app.test' }
  const route = { nombre: 'Ruta Norte', descripcion: 'Sector A', asignado_nombre: 'Pedro' }

  it('administrador recibe to_name genérico "Administrador"', () => {
    const vars = buildReminderVars({ userId: 'u2', email: 'a@x.com', rol: 'administrador' }, route, ctx)
    expect(vars.to_name).toBe('Administrador')
    expect(vars.rol_destinatario).toBe('administrador')
  })

  it('operador recibe su nombre asignado; sin nombre cae a su email', () => {
    const op: Recipient = { userId: 'u1', email: 'op@x.com', rol: 'operador' }
    expect(buildReminderVars(op, route, ctx).to_name).toBe('Pedro')
    expect(buildReminderVars(op, { ...route, asignado_nombre: null }, ctx).to_name).toBe('op@x.com')
  })

  it('mapea totales, fechas y empresa como strings de plantilla', () => {
    const vars = buildReminderVars({ userId: 'u1', email: 'op@x.com', rol: 'operador' }, route, ctx)
    expect(vars).toMatchObject({
      ruta_nombre: 'Ruta Norte',
      ruta_descripcion: 'Sector A',
      fecha_ocurrencia: '09/07/2026',
      hora_ocurrencia: '08:00',
      total_items: '5',
      tipo_items: 'contadores',
      empresa_nombre: 'Mayan',
      app_url: 'https://app.test',
    })
  })
})

describe('route-reminders/renderRecordatorio', () => {
  it('subject incluye nombre de ruta y empresa (con defaults)', () => {
    expect(renderRecordatorio({ ruta_nombre: 'Ruta Norte', empresa_nombre: 'Mayan' }).subject)
      .toBe('Recordatorio de ruta: Ruta Norte | Mayan')
    expect(renderRecordatorio({}).subject).toBe('Recordatorio de ruta: Ruta | AdministraTodo')
  })

  it('el html trae los detalles y omite la fila de descripción si no hay', () => {
    const conDesc = renderRecordatorio({ ruta_nombre: 'R', ruta_descripcion: 'Sector A', total_items: '5', tipo_items: 'contadores' })
    expect(conDesc.html).toContain('Sector A')
    expect(conDesc.html).toContain('5 contadores')
    const sinDesc = renderRecordatorio({ ruta_nombre: 'R' })
    expect(sinDesc.html).not.toContain('Descripción')
  })

  it('el CTA usa vars.app_url y cae al fallback si viene vacío', () => {
    expect(renderRecordatorio({ app_url: 'https://mi.app' }, 'https://fallback').html)
      .toContain('href="https://mi.app"')
    expect(renderRecordatorio({}, 'https://fallback').html)
      .toContain('href="https://fallback"')
  })
})

describe('route-reminders/buildInAppRows', () => {
  const route = { id: 'r1', company_id: 'c1', nombre: 'Ruta Norte' }
  const occ = { id: 'o1' }
  const ctx = { fechaFmt: '09/07/2026', horaFmt: '08:00', total: 3, tipo: 'clientes' }

  it('solo genera filas para destinatarios con userId', () => {
    const rows = buildInAppRows(
      [
        { userId: 'u1', email: 'a@x.com', rol: 'operador' },
        { userId: null, email: 'sin-cuenta@x.com', rol: 'administrador' },
      ],
      route, occ, ctx,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      user_id: 'u1',
      company_id: 'c1',
      tipo: 'ruta_recordatorio',
      titulo: 'Ruta programada: Ruta Norte',
      cuerpo: 'Tienes la ruta "Ruta Norte" programada para el 09/07/2026 a las 08:00. 3 clientes por leer.',
      seccion: 'rutas',
      ruta_id: 'r1',
      ocurrencia_id: 'o1',
    })
  })

  it('sin hora omite el " a las HH:MM" del cuerpo', () => {
    const rows = buildInAppRows(
      [{ userId: 'u1', email: null, rol: 'operador' }],
      route, occ, { ...ctx, horaFmt: '' },
    )
    expect(rows[0].cuerpo).toBe('Tienes la ruta "Ruta Norte" programada para el 09/07/2026. 3 clientes por leer.')
  })
})

describe('route-reminders/buildRawMessage', () => {
  // Guard del PR-15, igual que en send-email: `To` es la única cabecera sin
  // codificar, o sea la única inyectable. La versión original de este helper
  // metía el destinatario en crudo.
  it('rechaza inyección de cabeceras por el destinatario (CRLF)', () => {
    expect(() => buildRawMessage(
      'a@b.com', 'victima@x.com\r\nBcc: atacante@evil.com', 'Asunto', '<p>x</p>',
    )).toThrow()
  })

  it('produce base64url (sin + / =) decodificable al MIME original', () => {
    const raw = buildRawMessage('from@x.com', 'to@y.com', 'Lecturas número 1', '<p>Hola</p>', 1234567890)
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/)
    const mime = decodeURIComponent(escape(atob(raw.replace(/-/g, '+').replace(/_/g, '/'))))
    expect(mime).toContain('From: from@x.com')
    expect(mime).toContain('To: to@y.com')
    expect(mime).toContain('boundary="----=_Part_1234567890"')
    // Subject RFC 2047 en base64 UTF-8 (soporta acentos).
    expect(mime).toContain(`Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent('Lecturas número 1')))}?=`)
    // Cuerpo HTML como parte base64.
    expect(mime).toContain(btoa(unescape(encodeURIComponent('<p>Hola</p>'))))
    expect(mime).toContain('------=_Part_1234567890--')
  })
})
