// T7/PR3 — Contrato de reportes guardados (empresa/reportes): CRUD de
// templates, runs, el SELECT dinámico con filtros y el log de corrida (resuelve
// el actor con auth.getUser). Mock encadenable thenable + getUser.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  // `results` es una cola FIFO para flujos con varias consultas encadenadas
  // (p.ej. runReportQuery scope 'project': prefetch de projects + página(s));
  // si está vacía, se usa `result` para todo (comportamiento previo).
  const state: { result: unknown; results: unknown[]; calls: Array<[string, ...unknown[]]> } =
    { result: { data: null, error: null }, results: [], calls: [] }
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'delete', 'update', 'eq', 'in', 'is', 'order', 'limit', 'range']) {
    builder[m] = (...args: unknown[]) => { state.calls.push([m, ...args]); return builder }
  }
  builder.then = (resolve: (v: unknown) => void) =>
    resolve(state.results.length > 0 ? state.results.shift() : state.result)
  const getUser = vi.fn()
  return { state, builder, getUser }
})

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => { h.state.calls.push(['from', table]); return h.builder },
    auth: { getUser: h.getUser },
  },
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
  h.state.results = []
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
  it('scope company: filtra company_id + deleted_at null + filtros guardados (ignora vacíos)', async () => {
    h.state.result = { data: [{ id: 1 }, { id: 2 }], error: null }
    const r = await runReportQuery('cuotas_condominio', 'co1', { estado: 'pendiente', mes: '', nada: null })
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

  it('scope project (pagos sin company_id): resuelve proyectos del tenant y filtra por in(project_id)', async () => {
    h.state.results = [
      { data: [{ id: 'p1' }, { id: 'p2' }], error: null },     // prefetch projects
      { data: [{ id: 'pay1' }], error: null },                  // página única de pagos
    ]
    const r = await runReportQuery('pagos', 'co1', {})
    expect(r).toEqual({ data: [{ id: 'pay1' }], error: null, truncated: false })
    expect(h.state.calls).toContainEqual(['from', 'projects'])
    expect(h.state.calls).toContainEqual(['in', 'project_id', ['p1', 'p2']])
    // pagos SÍ tiene deleted_at (F2.7)
    expect(h.state.calls).toContainEqual(['is', 'deleted_at', null])
  })

  it('scope project sin proyectos: devuelve vacío sin consultar la tabla', async () => {
    h.state.results = [{ data: [], error: null }]
    const r = await runReportQuery('registros', 'co1', {})
    expect(r).toEqual({ data: [], error: null, truncated: false })
    expect(h.state.calls.filter(c => c[0] === 'from')).toEqual([['from', 'projects']])
  })

  it('registros: proyección explícita sin foto/gps', async () => {
    h.state.results = [
      { data: [{ id: 'p1' }], error: null },
      { data: [{ id: 'r1' }], error: null },
    ]
    await runReportQuery('registros', 'co1', {})
    const selects = h.state.calls.filter(c => c[0] === 'select')
    const selectCall = selects[selects.length - 1]
    expect(String(selectCall?.[1])).toContain('consumo')
    expect(String(selectCall?.[1])).not.toContain('foto')
    expect(String(selectCall?.[1])).not.toContain('gps')
  })

  it('tablas sin deleted_at (conta_asientos, gastos_condominio): no filtran soft delete', async () => {
    h.state.result = { data: [], error: null }
    await runReportQuery('conta_asientos', 'co1', {})
    expect(h.state.calls).not.toContainEqual(['is', 'deleted_at', null])
    h.state.calls = []
    await runReportQuery('gastos_condominio', 'co1', {})
    expect(h.state.calls).not.toContainEqual(['is', 'deleted_at', null])
    expect(h.state.calls).toContainEqual(['eq', 'company_id', 'co1'])
  })

  it('tabla fuera de la whitelist → error sin consultar', async () => {
    const r = await runReportQuery('companies', 'co1', {})
    expect(r.data).toBeNull()
    expect(r.error).toContain('no soportada')
    expect(h.state.calls).toEqual([])
  })

  it('error → mensaje legible (sin filas)', async () => {
    h.state.result = { data: null, error: { message: 'rls' } }
    expect(await runReportQuery('cuotas_condominio', 'co1', {})).toEqual({ data: null, error: 'rls', truncated: false })
  })
})
