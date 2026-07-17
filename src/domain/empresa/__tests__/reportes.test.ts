// T7/PR3 — Contrato de reportes guardados (empresa/reportes): CRUD de
// templates, runs, el SELECT dinámico con filtros y el log de corrida (resuelve
// el actor con auth.getUser). Mock encadenable thenable + getUser.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state: { result: unknown; calls: Array<[string, ...unknown[]]> } = { result: { data: null, error: null }, calls: [] }
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'delete', 'update', 'eq', 'is', 'order', 'limit', 'range']) {
    builder[m] = (...args: unknown[]) => { state.calls.push([m, ...args]); return builder }
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(state.result)
  const getUser = vi.fn()
  return { state, builder, getUser }
})

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => h.builder, auth: { getUser: h.getUser } },
}))

import {
  fetchReportTemplates,
  createReportTemplate,
  deleteReportTemplate,
  updateReportTemplateRecipients,
  fetchReportRuns,
  runReportQuery,
  logReportRun,
} from '../reportes'

beforeEach(() => {
  h.state.result = { data: null, error: null }
  h.state.calls = []
  h.getUser.mockReset()
  h.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
})

describe('templates', () => {
  it('fetchReportTemplates filtra por company_id y devuelve data', async () => {
    h.state.result = { data: [{ id: 't1' }], error: null }
    expect(await fetchReportTemplates('co1')).toEqual({ data: [{ id: 't1' }], error: null })
    expect(h.state.calls).toContainEqual(['eq', 'company_id', 'co1'])
  })

  it('createReportTemplate error → mensaje legible', async () => {
    h.state.result = { error: { message: 'denied' } }
    expect(await createReportTemplate({ name: 'X' })).toEqual({ error: 'denied' })
  })

  it('deleteReportTemplate éxito', async () => {
    h.state.result = { error: null }
    expect(await deleteReportTemplate('t1')).toEqual({ error: null })
    expect(h.state.calls).toContainEqual(['eq', 'id', 't1'])
  })

  it('updateReportTemplateRecipients actualiza recipients', async () => {
    h.state.result = { error: null }
    expect(await updateReportTemplateRecipients('t1', ['a@b.com'])).toEqual({ error: null })
    expect(h.state.calls).toContainEqual(['update', { recipients: ['a@b.com'] }])
  })
})

describe('runs', () => {
  it('fetchReportRuns limita a 5 y filtra por template_id', async () => {
    h.state.result = { data: [{ id: 1 }], error: null }
    expect(await fetchReportRuns('t1')).toEqual({ data: [{ id: 1 }], error: null })
    expect(h.state.calls).toContainEqual(['eq', 'template_id', 't1'])
    expect(h.state.calls).toContainEqual(['limit', 5])
  })

  it('logReportRun resuelve actor con getUser e inserta', async () => {
    h.state.result = { error: null }
    await logReportRun({
      templateId: 't1', companyId: 'co1', triggeredBy: 'manual',
      rowsCount: 3, format: 'xlsx', status: 'success', errorMsg: null,
    })
    expect(h.getUser).toHaveBeenCalled()
    const insertCall = h.state.calls.find(c => c[0] === 'insert')
    expect(insertCall?.[1]).toMatchObject({ template_id: 't1', actor_id: 'u1', rows_count: 3, status: 'success' })
  })

  it('logReportRun con sesión nula → actor_id null', async () => {
    h.getUser.mockResolvedValueOnce({ data: { user: null } })
    h.state.result = { error: null }
    await logReportRun({
      templateId: 't1', companyId: 'co1', triggeredBy: 'scheduled',
      rowsCount: 0, format: 'csv', status: 'failed', errorMsg: 'boom',
    })
    const insertCall = h.state.calls.find(c => c[0] === 'insert')
    expect(insertCall?.[1]).toMatchObject({ actor_id: null, error_msg: 'boom', triggered_by: 'scheduled' })
  })
})

describe('runReportQuery', () => {
  it('filtra company_id + deleted_at null + filtros guardados (ignora vacíos)', async () => {
    h.state.result = { data: [{ id: 1 }, { id: 2 }], error: null }
    const r = await runReportQuery('pagos', 'co1', { estado: 'pendiente', mes: '', nada: null })
    // D1: paginación estable server-side (order id + range) sin truncar.
    expect(r).toEqual({ data: [{ id: 1 }, { id: 2 }], error: null, truncated: false })
    expect(h.state.calls).toContainEqual(['eq', 'company_id', 'co1'])
    expect(h.state.calls).toContainEqual(['is', 'deleted_at', null])
    expect(h.state.calls).toContainEqual(['eq', 'estado', 'pendiente'])
    expect(h.state.calls).toContainEqual(['order', 'id', { ascending: true }])
    expect(h.state.calls).toContainEqual(['range', 0, 999])
    // los vacíos no generan eq
    expect(h.state.calls).not.toContainEqual(['eq', 'mes', ''])
    expect(h.state.calls).not.toContainEqual(['eq', 'nada', null])
  })

  it('error → mensaje legible (sin filas)', async () => {
    h.state.result = { data: null, error: { message: 'rls' } }
    expect(await runReportQuery('pagos', 'co1', {})).toEqual({ data: null, error: 'rls', truncated: false })
  })
})
