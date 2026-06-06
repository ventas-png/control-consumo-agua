// T7/PR3 — Contrato de los stats de conversaciones del dashboard admin. Mock
// encadenable: el builder es thenable y resuelve, en orden, los resultados en cola
// (Promise.all consume uno por cada conteo).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state: { results: unknown[] } = { results: [] }
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'is', 'gte', 'lt', 'order']) {
    builder[m] = () => builder
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(state.results.shift())
  return { state, builder }
})

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => h.builder } }))

import { fetchConvCountsForProject, fetchConvRowsAllProjects } from '../queries'

beforeEach(() => { h.state.results = [] })

const params = { companyId: 'co1', projectId: 'p1', hace24h: 'T-24', hace48h: 'T-48', abiertos: ['abierta'] }

describe('fetchConvCountsForProject', () => {
  it('mapea los 5 conteos en orden', async () => {
    h.state.results = [{ count: 1 }, { count: 2 }, { count: 3 }, { count: 4 }, { count: 5 }]
    expect(await fetchConvCountsForProject(params)).toEqual({
      sinAsignar: 1, cerradasHoy: 2, criticas: 3, urgentes: 4, enProceso: 5,
    })
  })

  it('count null → 0', async () => {
    h.state.results = [{ count: null }, { count: null }, { count: null }, { count: null }, { count: null }]
    expect(await fetchConvCountsForProject(params)).toEqual({
      sinAsignar: 0, cerradasHoy: 0, criticas: 0, urgentes: 0, enProceso: 0,
    })
  })
})

describe('fetchConvRowsAllProjects', () => {
  it('devuelve las filas', async () => {
    h.state.results = [{ data: [{ project_id: 'p1', status: 'abierta', assigned_to: null, created_at: 'x', closed_at: null }] }]
    expect(await fetchConvRowsAllProjects('co1')).toEqual([
      { project_id: 'p1', status: 'abierta', assigned_to: null, created_at: 'x', closed_at: null },
    ])
  })

  it('data null → []', async () => {
    h.state.results = [{ data: null }]
    expect(await fetchConvRowsAllProjects('co1')).toEqual([])
  })
})
