// T7/plat:P13 — Tests de los parsers PUROS de la sesión (antes inline en
// useAuth.ts, sin cobertura). Cubren el contrato de get_user_permissions y
// user_roles → UserSession (permisos, ids de rol, roles asignados).
import { describe, it, expect, vi } from 'vitest'

// session.ts importa lib/supabase (inicializa el cliente). Los parsers bajo
// prueba son PUROS; appUserProfileExists sí lee, así que el mock encadenable
// expone .from().select().eq().maybeSingle() con un resultado configurable.
const { maybeSingle } = vi.hoisted(() => ({ maybeSingle: vi.fn() }))
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const c: Record<string, unknown> = {}
      c.select = () => c
      c.eq = () => c
      c.maybeSingle = maybeSingle
      return c
    },
  },
}))

import {
  buildPermissionsSet,
  buildAssignedRoleIds,
  buildAssignedRoles,
  appUserProfileExists,
} from '../session'

describe('appUserProfileExists', () => {
  it('hay perfil → true', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { id: 'u1' }, error: null })
    expect(await appUserProfileExists('u1')).toBe(true)
  })
  it('sin perfil → false', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    expect(await appUserProfileExists('u1')).toBe(false)
  })
})

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

  it('expande el linaje: incluye el cloned_from_role_id de las copias de plantilla', () => {
    expect(
      buildAssignedRoleIds({
        data: [
          { role_id: 'copy1', role: { cloned_from_role_id: 'tpl1' } },
          { role_id: 'r2', role: { cloned_from_role_id: null } },
        ],
        error: null,
      }),
    ).toEqual(['copy1', 'tpl1', 'r2'])
  })

  it('no duplica ids cuando dos copias nacen de la misma plantilla', () => {
    expect(
      buildAssignedRoleIds({
        data: [
          { role_id: 'a', role: { cloned_from_role_id: 'tpl1' } },
          { role_id: 'b', role: { cloned_from_role_id: 'tpl1' } },
        ],
        error: null,
      }),
    ).toEqual(['a', 'tpl1', 'b'])
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

  it('filtra el rol oculto de ajustes individuales (user_override_for)', () => {
    const out = buildAssignedRoles({
      data: [
        { role_id: 'r1', role: { id: 'r1', name: 'Cobrador', service: 'agua', color: '#fff' } },
        { role_id: 'ov', role: { id: 'ov', name: 'Ajustes — Juan', service: null, color: null, user_override_for: 'u1' } },
      ],
      error: null,
    })
    expect(out).toEqual([{ id: 'r1', name: 'Cobrador', service: 'agua', color: '#fff' }])
  })
})
