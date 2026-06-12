// T7/PR3 — Contrato del dominio RBAC del tenant (empresa/roles): lecturas que
// degradan a `[]`/null y mutaciones que mapean el error a `string`. Mock
// encadenable "thenable" (igual que clientes): cada paso devuelve el builder y
// resuelve a `state.result`.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  // `queue`: resultados consumidos en orden para funciones multi-query
  // (ensureCompanyRoleFromTemplate); vacía → siempre `result`.
  const state: { result: unknown; queue: unknown[] } = { result: { data: null, error: null }, queue: [] }
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'or', 'is', 'order', 'limit', 'single', 'maybeSingle']) {
    builder[m] = () => builder
  }
  builder.then = (resolve: (v: unknown) => void) =>
    resolve(state.queue.length > 0 ? state.queue.shift() : state.result)
  return { state, builder }
})

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => h.builder },
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
  fetchAllRolePermissionKeys,
  updateRole,
  createRole,
  deleteRolePermissions,
  insertRolePermissions,
  fetchRolePermissionsWithEffect,
  fetchUserOverrideRole,
  createOverrideRole,
  ensureCompanyRoleFromTemplate,
} from '../roles'

beforeEach(() => { h.state.result = { data: null, error: null }; h.state.queue = [] })
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

  it('fetchAllRolePermissionKeys éxito (sin filtro effect)', async () => {
    setResult({ data: [{ permission_key: 'k' }], error: null })
    expect(await fetchAllRolePermissionKeys('r1')).toEqual({ data: [{ permission_key: 'k' }], error: null })
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
