// T7/plat:P13 — Tests de los parsers PUROS de la sesión (antes inline en
// useAuth.ts, sin cobertura). Cubren el contrato de get_user_permissions y
// user_roles → UserSession (permisos, ids de rol, roles asignados).
import { describe, it, expect, vi } from 'vitest'

// session.ts importa lib/supabase (inicializa el cliente); los helpers bajo prueba
// son PUROS y no lo usan, así que lo stubeamos para no tocar red/env — mismo
// patrón que el resto de tests de domain/.
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))

import {
  buildPermissionsSet,
  buildAssignedRoleIds,
  buildAssignedRoles,
} from '../session'

describe('buildPermissionsSet', () => {
  it('error o sin data → undefined (no asume permisos)', () => {
    expect(buildPermissionsSet({ data: null, error: { message: 'x' } })).toBeUndefined()
    expect(buildPermissionsSet({ data: null, error: null })).toBeUndefined()
  })

  it('array de strings (SETOF text) → Set', () => {
    const s = buildPermissionsSet({ data: ['agua.read', 'cobros.write'], error: null })
    expect(s).toEqual(new Set(['agua.read', 'cobros.write']))
  })

  it('array de { get_user_permissions } → Set', () => {
    const s = buildPermissionsSet({
      data: [{ get_user_permissions: 'agua.read' }, { get_user_permissions: 'cobros.write' }],
      error: null,
    })
    expect(s).toEqual(new Set(['agua.read', 'cobros.write']))
  })

  it('mezcla / filas basura → solo strings válidos', () => {
    const s = buildPermissionsSet({
      data: ['a', { get_user_permissions: 'b' }, { nope: 1 }, null],
      error: null,
    })
    expect(s).toEqual(new Set(['a', 'b']))
  })

  it('array vacío → Set vacío (autenticado sin permisos ≠ undefined)', () => {
    expect(buildPermissionsSet({ data: [], error: null })).toEqual(new Set())
  })
})

describe('buildAssignedRoleIds', () => {
  it('error o sin data → undefined', () => {
    expect(buildAssignedRoleIds({ data: null, error: { message: 'x' } })).toBeUndefined()
    expect(buildAssignedRoleIds({ data: undefined, error: null })).toBeUndefined()
  })

  it('extrae los role_id en orden', () => {
    expect(
      buildAssignedRoleIds({ data: [{ role_id: 'r1' }, { role_id: 'r2' }], error: null }),
    ).toEqual(['r1', 'r2'])
  })
})

describe('buildAssignedRoles', () => {
  it('error o sin data → undefined', () => {
    expect(buildAssignedRoles({ data: null, error: { message: 'x' } })).toBeUndefined()
  })

  it('descarta filas con role null (join sin match)', () => {
    const out = buildAssignedRoles({
      data: [
        { role_id: 'r1', role: { id: 'r1', name: 'Admin Agua', service: 'agua', color: '#fff' } },
        { role_id: 'r2', role: null },
      ],
      error: null,
    })
    expect(out).toEqual([{ id: 'r1', name: 'Admin Agua', service: 'agua', color: '#fff' }])
  })

  it('service fuera de {condominios,agua,general} → null', () => {
    const out = buildAssignedRoles({
      data: [{ role_id: 'r1', role: { id: 'r1', name: 'X', service: 'otro', color: null } }],
      error: null,
    })
    expect(out).toEqual([{ id: 'r1', name: 'X', service: null, color: null }])
  })

  it('conserva service válido y color', () => {
    const out = buildAssignedRoles({
      data: [{ role_id: 'r1', role: { id: 'r1', name: 'Y', service: 'general', color: '#abc' } }],
      error: null,
    })
    expect(out).toEqual([{ id: 'r1', name: 'Y', service: 'general', color: '#abc' }])
  })
})
