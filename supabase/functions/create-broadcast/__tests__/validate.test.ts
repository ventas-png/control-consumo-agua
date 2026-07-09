// Tests de la lógica pura de create-broadcast (infra:I22 · Track T8/T5). Como el
// resto de tests de edge fns, corre bajo vitest (no Deno) tratando el módulo como
// TS normal. Cubre: el gate de rol para enviar comunicados (fan-out a cientos de
// clientes) y la normalización/validación del body. La resolución de audiencia
// se prueba aparte en _shared/__tests__/broadcastAudience.test.ts.

import { describe, it, expect } from 'vitest'
import {
  BROADCAST_SENDER_ROLES,
  VALID_TARGETS,
  canCreateBroadcast,
  parseBroadcastRequest,
} from '../validate.ts'

describe('create-broadcast/canCreateBroadcast', () => {
  it('permite solo a super/owner/admin (el fan-out es masivo)', () => {
    for (const role of ['super_admin', 'superadmin', 'company_owner', 'admin']) {
      expect(canCreateBroadcast(role)).toBe(true)
    }
  })

  it('rechaza roles operativos, residentes y desconocidos', () => {
    for (const role of ['operator', 'operador', 'viewer', 'visor', 'collector', 'residente', '', 'Admin']) {
      expect(canCreateBroadcast(role)).toBe(false)
    }
  })

  it('el whitelist coincide con la constante exportada', () => {
    expect(BROADCAST_SENDER_ROLES).toEqual(['super_admin', 'superadmin', 'company_owner', 'admin'])
  })
})

describe('create-broadcast/parseBroadcastRequest', () => {
  const base = { title: 'Corte de agua', body: 'Mañana 8am', target_type: 'todos' as const }

  it('normaliza un request válido (trim + defaults)', () => {
    const r = parseBroadcastRequest({ ...base, title: '  Corte de agua  ' })
    expect(r).toEqual({
      ok: true,
      title: 'Corte de agua',
      message: 'Mañana 8am',
      targetType: 'todos',
      targetIds: [],
      sendEmail: false,
    })
  })

  it('rechaza en orden: título → mensaje → audiencia (mismos mensajes del handler)', () => {
    expect(parseBroadcastRequest({})).toEqual({ ok: false, error: 'El título es obligatorio.' })
    expect(parseBroadcastRequest({ title: '   ' })).toEqual({ ok: false, error: 'El título es obligatorio.' })
    expect(parseBroadcastRequest({ title: 'x' })).toEqual({ ok: false, error: 'El mensaje es obligatorio.' })
    expect(parseBroadcastRequest({ title: 'x', body: 'y' })).toEqual({ ok: false, error: 'Tipo de audiencia inválido.' })
    expect(parseBroadcastRequest({ title: 'x', body: 'y', target_type: 'empresa' as never }))
      .toEqual({ ok: false, error: 'Tipo de audiencia inválido.' })
  })

  it('acepta exactamente los 4 target types válidos', () => {
    expect(VALID_TARGETS).toEqual(['todos', 'proyecto', 'unidades', 'clientes'])
    for (const t of VALID_TARGETS) {
      expect(parseBroadcastRequest({ title: 'x', body: 'y', target_type: t }).ok).toBe(true)
    }
  })

  it('target_ids que no sea array real se normaliza a [] (no revienta el .in())', () => {
    const r = parseBroadcastRequest({ ...base, target_ids: 'abc' as never })
    expect(r.ok && r.targetIds).toEqual([])
  })

  it('send_email exige === true estricto (truthy arbitrario no encola correos)', () => {
    const conEmail = parseBroadcastRequest({ ...base, send_email: true })
    expect(conEmail.ok && conEmail.sendEmail).toBe(true)
    for (const v of ['true', 1, {}] as never[]) {
      const r = parseBroadcastRequest({ ...base, send_email: v })
      expect(r.ok && r.sendEmail).toBe(false)
    }
  })
})
