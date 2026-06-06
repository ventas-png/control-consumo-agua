// T7/PR3 — Contrato de trazabilidad/papelera (empresa/auditoria): lecturas
// paginadas con filtros y mutación de restore. Mock encadenable thenable que
// registra los filtros aplicados para afirmar el scope.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state: { result: unknown; calls: Array<[string, ...unknown[]]> } = { result: { data: null, error: null }, calls: [] }
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'order', 'range', 'eq', 'gte', 'lte', 'not', 'in', 'update']) {
    builder[m] = (...args: unknown[]) => { state.calls.push([m, ...args]); return builder }
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(state.result)
  return { state, builder }
})

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => h.builder } }))

import {
  fetchPermissionAuditLog,
  fetchRoleNamesByIds,
  fetchFinancialAuditLog,
  fetchDeletedRows,
  restoreDeletedRows,
} from '../auditoria'

beforeEach(() => { h.state.result = { data: null, error: null }; h.state.calls = [] })

describe('fetchPermissionAuditLog', () => {
  it('sin filtro → no aplica eq(action); devuelve filas', async () => {
    h.state.result = { data: [{ id: 1, action: 'assign_role' }], error: null }
    const r = await fetchPermissionAuditLog({ page: 0, pageSize: 50 })
    expect(r).toEqual({ data: [{ id: 1, action: 'assign_role' }], error: null })
    expect(h.state.calls.some(c => c[0] === 'eq')).toBe(false)
    expect(h.state.calls).toContainEqual(['range', 0, 49])
  })

  it('con filtro → aplica eq(action)', async () => {
    h.state.result = { data: [], error: null }
    await fetchPermissionAuditLog({ page: 1, pageSize: 50, action: 'create_role' })
    expect(h.state.calls).toContainEqual(['eq', 'action', 'create_role'])
    expect(h.state.calls).toContainEqual(['range', 50, 99])
  })

  it('error → mensaje legible', async () => {
    h.state.result = { data: null, error: { message: 'rls' } }
    expect(await fetchPermissionAuditLog({ page: 0, pageSize: 50 })).toEqual({ data: null, error: 'rls' })
  })
})

describe('fetchRoleNamesByIds', () => {
  it('degrada a [] sin data', async () => {
    h.state.result = { data: null, error: null }
    expect(await fetchRoleNamesByIds(['r1'])).toEqual([])
  })
  it('devuelve filas', async () => {
    h.state.result = { data: [{ id: 'r1', name: 'Admin', color: '#fff' }], error: null }
    expect(await fetchRoleNamesByIds(['r1'])).toEqual([{ id: 'r1', name: 'Admin', color: '#fff' }])
  })
})

describe('fetchFinancialAuditLog', () => {
  it('aplica todos los filtros (tabla/acción/fechas)', async () => {
    h.state.result = { data: [], error: null }
    await fetchFinancialAuditLog({ page: 0, pageSize: 50, tableName: 'pagos', action: 'UPDATE', from: '2026-01-01', to: '2026-01-31' })
    expect(h.state.calls).toContainEqual(['eq', 'table_name', 'pagos'])
    expect(h.state.calls).toContainEqual(['eq', 'action', 'UPDATE'])
    expect(h.state.calls).toContainEqual(['gte', 'occurred_at', '2026-01-01T00:00:00'])
    expect(h.state.calls).toContainEqual(['lte', 'occurred_at', '2026-01-31T23:59:59'])
  })

  it('sin filtros → sólo paginación', async () => {
    h.state.result = { data: [{ id: 9 }], error: null }
    const r = await fetchFinancialAuditLog({ page: 0, pageSize: 50 })
    expect(r).toEqual({ data: [{ id: 9 }], error: null })
    expect(h.state.calls.some(c => c[0] === 'eq' || c[0] === 'gte' || c[0] === 'lte')).toBe(false)
  })
})

describe('papelera', () => {
  it('fetchDeletedRows ordena por deleted_at + orderCol y filtra not-null', async () => {
    h.state.result = { data: [{ id: 'x', deleted_at: 't', deleted_by: null }], error: null }
    const r = await fetchDeletedRows('pagos', 'created_at', 0, 25)
    expect(r).toEqual({ data: [{ id: 'x', deleted_at: 't', deleted_by: null }], error: null })
    expect(h.state.calls).toContainEqual(['not', 'deleted_at', 'is', null])
    expect(h.state.calls).toContainEqual(['order', 'created_at', { ascending: false }])
    expect(h.state.calls).toContainEqual(['range', 0, 24])
  })

  it('restoreDeletedRows limpia deleted_at/by para los ids', async () => {
    h.state.result = { error: null }
    expect(await restoreDeletedRows('pagos', ['a', 'b'])).toEqual({ error: null })
    expect(h.state.calls).toContainEqual(['update', { deleted_at: null, deleted_by: null }])
    expect(h.state.calls).toContainEqual(['in', 'id', ['a', 'b']])
  })

  it('restoreDeletedRows error → mensaje legible', async () => {
    h.state.result = { error: { message: 'denied' } }
    expect(await restoreDeletedRows('pagos', ['a'])).toEqual({ error: 'denied' })
  })
})
