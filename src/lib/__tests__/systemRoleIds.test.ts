import { describe, it, expect } from 'vitest'
import { SYSTEM_ROLE_IDS } from '../systemRoleIds'

// ════════════════════════════════════════════════════════════════════════════
// plat:P15 — Mapa RBAC de IDs de roles de sistema. Lógica PURA.
//
// SYSTEM_ROLE_IDS espeja UUIDs sembrados por las migraciones 20260518000006
// (condominios) y 20260518000011 (agua). Si estos UUIDs se desincronizan del
// servidor, la asignación de roles apunta a roles inexistentes → RBAC roto
// (acceso denegado o, peor, rol equivocado). Estos tests fijan el contrato:
// formato, unicidad GLOBAL entre servicios, y los valores exactos de la semilla.
// ════════════════════════════════════════════════════════════════════════════

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function allEntries(): Array<[string, string, string]> {
  // [service, roleKey, uuid]
  const out: Array<[string, string, string]> = []
  for (const [service, roles] of Object.entries(SYSTEM_ROLE_IDS)) {
    for (const [roleKey, uuid] of Object.entries(roles)) {
      out.push([service, roleKey, uuid])
    }
  }
  return out
}

describe('SYSTEM_ROLE_IDS — formato y forma', () => {
  it('expone exactamente los servicios condominios y agua', () => {
    expect(Object.keys(SYSTEM_ROLE_IDS).sort()).toEqual(['agua', 'condominios'])
  })

  it('condominios tiene los 8 roles esperados', () => {
    expect(Object.keys(SYSTEM_ROLE_IDS.condominios).sort()).toEqual(
      [
        'administrador_general',
        'comunidad',
        'finanzas',
        'junta_directiva',
        'operaciones',
        'recepcion',
        'seguridad',
        'visualizador',
      ].sort(),
    )
  })

  it('agua tiene los 4 roles esperados', () => {
    expect(Object.keys(SYSTEM_ROLE_IDS.agua).sort()).toEqual(
      ['admin', 'collector', 'operator', 'viewer'].sort(),
    )
  })

  it('todos los valores son UUIDs válidos en minúscula', () => {
    for (const [service, roleKey, uuid] of allEntries()) {
      expect(UUID_RE.test(uuid), `${service}.${roleKey} = ${uuid}`).toBe(true)
    }
  })
})

describe('SYSTEM_ROLE_IDS — unicidad', () => {
  it('no hay UUIDs duplicados GLOBALMENTE (ni dentro ni entre servicios)', () => {
    const uuids = allEntries().map(([, , uuid]) => uuid)
    expect(new Set(uuids).size).toBe(uuids.length)
  })

  it('los espacios de UUID de condominios (…00xx) y agua (…01xx) no se solapan', () => {
    // Set<string> a propósito: los valores son literales (`as const`) de uniones
    // distintas, y .has() estricto rechazaría comparar entre servicios.
    const cond = new Set<string>(Object.values(SYSTEM_ROLE_IDS.condominios))
    const agua = new Set<string>(Object.values(SYSTEM_ROLE_IDS.agua))
    for (const id of agua) expect(cond.has(id)).toBe(false)
  })
})

describe('SYSTEM_ROLE_IDS — paridad con la semilla de migraciones', () => {
  // Estos valores son el contrato con 20260518000006 / 20260518000011. Cualquier
  // edición accidental que los corra rompe aquí ANTES de llegar a producción.
  it('condominios mantiene la secuencia …0001 → …0008', () => {
    expect(SYSTEM_ROLE_IDS.condominios).toEqual({
      administrador_general: '00000000-0000-0000-0000-000000000001',
      junta_directiva: '00000000-0000-0000-0000-000000000002',
      finanzas: '00000000-0000-0000-0000-000000000003',
      operaciones: '00000000-0000-0000-0000-000000000004',
      seguridad: '00000000-0000-0000-0000-000000000005',
      comunidad: '00000000-0000-0000-0000-000000000006',
      recepcion: '00000000-0000-0000-0000-000000000007',
      visualizador: '00000000-0000-0000-0000-000000000008',
    })
  })

  it('agua mantiene la secuencia …0101 → …0104', () => {
    expect(SYSTEM_ROLE_IDS.agua).toEqual({
      admin: '00000000-0000-0000-0000-000000000101',
      operator: '00000000-0000-0000-0000-000000000102',
      collector: '00000000-0000-0000-0000-000000000103',
      viewer: '00000000-0000-0000-0000-000000000104',
    })
  })
})
