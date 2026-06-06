// T7/PR3 — Contrato de los helpers CRUD genéricos de los tabs de condominios.
// Devuelven el error con shape { message } (el de supabase) sin mapear a string.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state: { result: unknown } = { result: { data: null, error: null } }
  const b: Record<string, unknown> = {}
  for (const m of ['insert', 'upsert', 'update', 'delete', 'eq', 'in', 'select', 'single']) b[m] = () => b
  b.then = (resolve: (v: unknown) => void) => resolve(state.result)
  return { state, b }
})
vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => h.b } }))

import {
  createCondominioRow,
  createCondominioRowReturning,
  upsertCondominioRow,
  updateCondominioRow,
  deleteCondominioRow,
  deleteCondominioRowBy,
  deleteCondominioRowsByIds,
  marcarCuotasMorosas,
} from '../tabMutations'

beforeEach(() => { h.state.result = { data: null, error: null } })

describe('tabMutations (CRUD genérico)', () => {
  it('createCondominioRow éxito → { error: null }', async () => {
    h.state.result = { error: null }
    expect(await createCondominioRow('amenidades', { nombre: 'Piscina' })).toEqual({ error: null })
  })

  it('createCondominioRow propaga el error con .message', async () => {
    h.state.result = { error: { message: 'rls' } }
    expect(await createCondominioRow('amenidades', {})).toEqual({ error: { message: 'rls' } })
  })

  it('createCondominioRow acepta lote (array)', async () => {
    h.state.result = { error: null }
    expect(await createCondominioRow('x', [{ a: 1 }, { a: 2 }])).toEqual({ error: null })
  })

  it('createCondominioRowReturning éxito → { data, error: null }', async () => {
    h.state.result = { data: { id: 'r1' }, error: null }
    expect(await createCondominioRowReturning('x', {})).toEqual({ data: { id: 'r1' }, error: null })
  })

  it('updateCondominioRow éxito → { error: null }', async () => {
    h.state.result = { error: null }
    expect(await updateCondominioRow('x', 'id1', { estado: 'ok' })).toEqual({ error: null })
  })

  it('deleteCondominioRow propaga el error', async () => {
    h.state.result = { error: { message: 'fk' } }
    expect(await deleteCondominioRow('x', 'id1')).toEqual({ error: { message: 'fk' } })
  })

  it('marcarCuotasMorosas éxito → { error: null }', async () => {
    h.state.result = { error: null }
    expect(await marcarCuotasMorosas(['c1', 'c2'])).toEqual({ error: null })
  })

  it('marcarCuotasMorosas propaga el error con .message', async () => {
    h.state.result = { error: { message: 'rls' } }
    expect(await marcarCuotasMorosas(['c1'])).toEqual({ error: { message: 'rls' } })
  })

  it('upsertCondominioRow éxito → { error: null }', async () => {
    h.state.result = { error: null }
    expect(await upsertCondominioRow('registro_asistentes_evento', { a: 1 }, 'evento_id,unidad_id')).toEqual({ error: null })
  })

  it('upsertCondominioRow propaga el error con .message', async () => {
    h.state.result = { error: { message: 'conflict' } }
    expect(await upsertCondominioRow('x', {})).toEqual({ error: { message: 'conflict' } })
  })

  it('deleteCondominioRowBy borra por columna distinta de id', async () => {
    h.state.result = { error: null }
    expect(await deleteCondominioRowBy('respuestas_encuesta', 'encuesta_id', 'e1')).toEqual({ error: null })
  })

  it('deleteCondominioRowBy propaga el error', async () => {
    h.state.result = { error: { message: 'fk' } }
    expect(await deleteCondominioRowBy('x', 'col', 'v')).toEqual({ error: { message: 'fk' } })
  })

  it('deleteCondominioRowsByIds con lista vacía es no-op (no error)', async () => {
    h.state.result = { error: { message: 'no debería llamarse' } }
    expect(await deleteCondominioRowsByIds('huespedes_str', [])).toEqual({ error: null })
  })

  it('deleteCondominioRowsByIds borra por .in y propaga error', async () => {
    h.state.result = { error: null }
    expect(await deleteCondominioRowsByIds('huespedes_str', ['a', 'b'])).toEqual({ error: null })
    h.state.result = { error: { message: 'boom' } }
    expect(await deleteCondominioRowsByIds('huespedes_str', ['a'])).toEqual({ error: { message: 'boom' } })
  })
})
