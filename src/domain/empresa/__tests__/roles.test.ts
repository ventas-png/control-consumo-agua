// T7/PR3 — Contrato del dominio RBAC del tenant (empresa/roles): lecturas que
// degradan a `[]`/null y mutaciones que mapean el error a `string`. Mock
// encadenable "thenable" (igual que clientes): cada paso devuelve el builder y
// resuelve a `state.result`.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  // `queue`: resultados consumidos en orden para funciones multi-query
  // (ensureCompanyRoleFromTemplate); vacía → siempre `result`.
  // `inCalls`/`rpcCalls`: para afirmar el troceado del delete y el payload de
  // la RPC de permisos.
  const state: { result: unknown; queue: unknown[]; inCalls: string[][]; rpcCalls: Array<[string, unknown]> } =
    { result: { data: null, error: null }, queue: [], inCalls: [], rpcCalls: [] }
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'or', 'is', 'order', 'limit', 'single', 'maybeSingle']) {
    builder[m] = () => builder
  }
  builder.in = (_col: string, values: string[]) => { state.inCalls.push(values); return builder }
  builder.then = (resolve: (v: unknown) => void) =>
    resolve(state.queue.length > 0 ? state.queue.shift() : state.result)
  const rpc = (fn: string, args: unknown) => {
    state.rpcCalls.push([fn, args])
    return { then: (resolve: (v: unknown) => void) => resolve(state.queue.length > 0 ? state.queue.shift() : state.result) }
  }
  return { state, builder, rpc }
})

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => h.builder, rpc: h.rpc },
}))

import {
  fetchCompanyRoles,
  fetchAllRolePermissions,
  fetchUserRoleAssignments,
  fetchUserRoleIds,
  deleteUserRoles,
  insertUserRoles,
  updateUserRoleExpiration,
  deleteRole,
  fetchPermissionsCatalog,
  fetchRoleById,
  fetchRolePermissionKeys,
  updateRole,
  createRole,
  deleteRolePermissions,
  insertRolePermissions,
  setRolePermissions,
  fetchRolePermissionsWithEffect,
  fetchUserOverrideRole,
  createOverrideRole,
  ensureCompanyRoleFromTemplate,
} from '../roles'

beforeEach(() => {
  h.state.result = { data: null, error: null }
  h.state.queue = []
  h.state.inCalls = []
  h.state.rpcCalls = []
})
function setResult(r: unknown) { h.state.result = r }
function setQueue(...rs: unknown[]) { h.state.queue = rs }

describe('lecturas RBAC', () => {
  it('fetchCompanyRoles éxito → { data, error: null }', async () => {
    setResult({ data: [{ id: 'r1', is_system: true }], error: null })
    expect(await fetchCompanyRoles('co1')).toEqual({ data: [{ id: 'r1', is_system: true }], error: null })
  })

  it('fetchCompanyRoles error → mensaje legible', async () => {
    setResult({ data: null, error: { message: 'rls' } })
    expect(await fetchCompanyRoles('co1')).toEqual({ data: null, error: 'rls' })
  })

  it('fetchAllRolePermissions éxito', async () => {
    setResult({ data: [{ role_id: 'r1', permission_key: 'k', effect: 'allow' }], error: null })
    expect(await fetchAllRolePermissions()).toEqual({
      data: [{ role_id: 'r1', permission_key: 'k', effect: 'allow' }], error: null,
    })
  })

  it('fetchUserRoleAssignments éxito', async () => {
    setResult({ data: [{ role_id: 'r1', expires_at: null }], error: null })
    expect(await fetchUserRoleAssignments('u1')).toEqual({ data: [{ role_id: 'r1', expires_at: null }], error: null })
  })

  it('fetchUserRoleIds éxito', async () => {
    setResult({ data: [{ role_id: 'r1' }], error: null })
    expect(await fetchUserRoleIds('u1')).toEqual({ data: [{ role_id: 'r1' }], error: null })
  })

  it('fetchPermissionsCatalog éxito', async () => {
    setResult({ data: [{ key: 'k', category: 'c', label: 'L' }], error: null })
    expect(await fetchPermissionsCatalog()).toEqual({ data: [{ key: 'k', category: 'c', label: 'L' }], error: null })
  })

  it('fetchRoleById éxito', async () => {
    setResult({ data: { id: 'r1', name: 'X' }, error: null })
    expect(await fetchRoleById('r1')).toEqual({ data: { id: 'r1', name: 'X' }, error: null })
  })

  it('fetchRolePermissionKeys éxito (allow)', async () => {
    setResult({ data: [{ permission_key: 'k' }], error: null })
    expect(await fetchRolePermissionKeys('r1')).toEqual({ data: [{ permission_key: 'k' }], error: null })
  })

})

describe('mutaciones RBAC', () => {
  it('deleteUserRoles éxito → { error: null }', async () => {
    setResult({ error: null })
    expect(await deleteUserRoles('u1', ['r1'])).toEqual({ error: null })
  })

  it('insertUserRoles error → mensaje legible', async () => {
    setResult({ error: { message: 'dup' } })
    expect(await insertUserRoles([{ user_id: 'u1', role_id: 'r1' }])).toEqual({ error: 'dup' })
  })

  it('updateUserRoleExpiration éxito', async () => {
    setResult({ error: null })
    expect(await updateUserRoleExpiration('u1', 'r1', '2030-01-01')).toEqual({ error: null })
  })

  it('deleteRole éxito', async () => {
    setResult({ error: null })
    expect(await deleteRole('r1')).toEqual({ error: null })
  })

  it('updateRole error → mensaje legible', async () => {
    setResult({ error: { message: 'denied' } })
    expect(await updateRole('r1', { name: 'X' })).toEqual({ error: 'denied' })
  })

  it('createRole éxito → devuelve el id', async () => {
    setResult({ data: { id: 'r9' }, error: null })
    expect(await createRole({ name: 'X' })).toEqual({ data: { id: 'r9' }, error: null })
  })

  it('deleteRolePermissions éxito', async () => {
    setResult({ error: null })
    expect(await deleteRolePermissions('r1', ['k'])).toEqual({ error: null })
  })

  // Las claves viajan en la URL: en una sola petición, una lista larga la
  // rechaza la pasarela con un «Bad Request» de texto plano antes de llegar a
  // PostgREST (bug del editor de roles).
  it('deleteRolePermissions trocea las claves en lotes de 40', async () => {
    setResult({ error: null })
    const keys = Array.from({ length: 95 }, (_, i) => `k${i}`)
    expect(await deleteRolePermissions('r1', keys)).toEqual({ error: null })
    expect(h.state.inCalls.map(c => c.length)).toEqual([40, 40, 15])
    expect(h.state.inCalls.flat()).toEqual(keys)
  })

  it('deleteRolePermissions corta en el primer lote que falla', async () => {
    setQueue({ error: null }, { error: { message: 'rls' } })
    const keys = Array.from({ length: 95 }, (_, i) => `k${i}`)
    expect(await deleteRolePermissions('r1', keys)).toEqual({ error: 'rls' })
    expect(h.state.inCalls).toHaveLength(2)
  })

  it('deleteRolePermissions con lista vacía no llama a la BD', async () => {
    expect(await deleteRolePermissions('r1', [])).toEqual({ error: null })
    expect(h.state.inCalls).toHaveLength(0)
  })

  it('setRolePermissions manda el conjunto entero en el cuerpo de la RPC', async () => {
    setResult({ data: 3, error: null })
    expect(await setRolePermissions('r1', ['a', 'b', 'c'])).toEqual({ error: null })
    expect(h.state.rpcCalls).toEqual([['set_role_permissions', { p_role_id: 'r1', p_keys: ['a', 'b', 'c'] }]])
  })

  it('setRolePermissions con lista vacía llama igual (vaciar el rol es válido)', async () => {
    setResult({ data: 0, error: null })
    expect(await setRolePermissions('r1', [])).toEqual({ error: null })
    expect(h.state.rpcCalls).toEqual([['set_role_permissions', { p_role_id: 'r1', p_keys: [] }]])
  })

  it('setRolePermissions error → mensaje legible', async () => {
    setResult({ data: null, error: { message: 'rls' } })
    expect(await setRolePermissions('r1', ['a'])).toEqual({ error: 'rls' })
  })

  it('insertRolePermissions error → mensaje legible', async () => {
    setResult({ error: { message: 'fk' } })
    expect(await insertRolePermissions([{ role_id: 'r1', permission_key: 'k', effect: 'allow' }])).toEqual({ error: 'fk' })
  })
})

describe('plantillas y ajustes individuales', () => {
  it('fetchRolePermissionsWithEffect éxito (incluye deny)', async () => {
    setResult({ data: [{ permission_key: 'k', effect: 'deny' }], error: null })
    expect(await fetchRolePermissionsWithEffect('r1')).toEqual({
      data: [{ permission_key: 'k', effect: 'deny' }], error: null,
    })
  })

  it('fetchUserOverrideRole con rol → { id }', async () => {
    setResult({ data: { id: 'ov1' }, error: null })
    expect(await fetchUserOverrideRole('u1')).toEqual({ data: { id: 'ov1' }, error: null })
  })

  it('fetchUserOverrideRole sin rol → data null', async () => {
    setResult({ data: null, error: null })
    expect(await fetchUserOverrideRole('u1')).toEqual({ data: null, error: null })
  })

  it('createOverrideRole éxito → devuelve el id', async () => {
    setResult({ data: { id: 'ov9' }, error: null })
    expect(await createOverrideRole('co1', 'u1', 'Ajustes — Juan (1a2b3c4d)')).toEqual({
      data: { id: 'ov9' }, error: null,
    })
  })

  it('ensureCompanyRoleFromTemplate reutiliza la adopción existente', async () => {
    setQueue(
      { data: { name: 'Cobrador', description: 'd', color: '#f59e0b', service: 'agua' }, error: null }, // plantilla
      { data: [{ id: 'copy1' }], error: null }, // adopción fiel encontrada
    )
    expect(await ensureCompanyRoleFromTemplate('co1', 'tpl1')).toEqual({ data: { id: 'copy1' }, error: null })
  })

  it('ensureCompanyRoleFromTemplate crea la copia y copia los permisos', async () => {
    setQueue(
      { data: { name: 'Cobrador', description: 'd', color: '#f59e0b', service: 'agua' }, error: null }, // plantilla
      { data: [], error: null },                  // sin adopción previa
      { data: { id: 'new1' }, error: null },      // insert del rol copia
      { data: [{ permission_key: 'agua.cobros.view', effect: 'allow' }], error: null }, // permisos plantilla
      { error: null },                            // insert role_permissions
    )
    expect(await ensureCompanyRoleFromTemplate('co1', 'tpl1')).toEqual({ data: { id: 'new1' }, error: null })
  })

  it('ensureCompanyRoleFromTemplate plantilla inexistente → error legible', async () => {
    setQueue({ data: null, error: { message: 'not found' } })
    expect(await ensureCompanyRoleFromTemplate('co1', 'tplX')).toEqual({ data: null, error: 'not found' })
  })
})
