// T7/PR3 — Contrato de los stats del dashboard de condominios + import de
// contactos de emergencia. Mock encadenable thenable con cola de resultados.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state: { results: unknown[] } = { results: [] }
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'is', 'gte', 'lt', 'neq', 'order', 'limit', 'insert']) {
    b[m] = () => b
  }
  b.then = (resolve: (v: unknown) => void) => resolve(state.results.shift())
  return { state, b }
})
// `db` es la misma instancia que `supabase` (retipada); el mock espeja eso.
vi.mock('../../../lib/supabase', () => {
  const client = { from: () => h.b }
  return { supabase: client, db: client }
})

import { fetchCondominioStatsForProject, fetchCondominioStatsRows } from '../queries'
import { createContactosEmergencia, createInventarioItems, createTareasCondominio } from '../mutations'

beforeEach(() => { h.state.results = [] })

describe('fetchCondominioStatsForProject', () => {
  it('mapea los 5 conteos en orden', async () => {
    h.state.results = [{ count: 1 }, { count: 2 }, { count: 3 }, { count: 4 }, { count: 5 }]
    expect(await fetchCondominioStatsForProject('co1', 'p1')).toEqual({
      cuotasPendientes: 1, cuotasMora: 2, visitantesHoy: 3, ticketsAbiertos: 4, comunSinAsignar: 5,
    })
  })
})

describe('fetchCondominioStatsRows', () => {
  it('devuelve las 4 colecciones (default [])', async () => {
    h.state.results = [
      { data: [{ project_id: 'p1', estado: 'pendiente' }] },
      { data: null },
      { data: [{ project_id: 'p1', estado: 'abierto' }] },
      { data: [{ project_id: 'p2' }] },
    ]
    expect(await fetchCondominioStatsRows('co1')).toEqual({
      cuotas: [{ project_id: 'p1', estado: 'pendiente' }],
      visitantes: [],
      tickets: [{ project_id: 'p1', estado: 'abierto' }],
      conversations: [{ project_id: 'p2' }],
    })
  })
})

describe('createContactosEmergencia', () => {
  it('éxito → { error: null }', async () => {
    h.state.results = [{ error: null }]
    expect(await createContactosEmergencia([{ nombre: 'x' }])).toEqual({ error: null })
  })
  it('error → mensaje legible', async () => {
    h.state.results = [{ error: { message: 'rls' } }]
    expect(await createContactosEmergencia([])).toEqual({ error: 'rls' })
  })
})

describe('createInventarioItems', () => {
  it('éxito → { error: null }', async () => {
    h.state.results = [{ error: null }]
    expect(await createInventarioItems([{ nombre: 'x' }])).toEqual({ error: null })
  })
  it('error → mensaje legible', async () => {
    h.state.results = [{ error: { message: 'rls' } }]
    expect(await createInventarioItems([])).toEqual({ error: 'rls' })
  })
})

describe('createTareasCondominio', () => {
  it('éxito → { error: null }', async () => {
    h.state.results = [{ error: null }]
    expect(await createTareasCondominio([{ titulo: 'x' }])).toEqual({ error: null })
  })
  it('error → mensaje legible', async () => {
    h.state.results = [{ error: { message: 'rls' } }]
    expect(await createTareasCondominio([])).toEqual({ error: 'rls' })
  })
})
