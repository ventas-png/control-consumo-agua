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
// `db` es la misma instancia que `supabase` (retipada); el mock espeja eso.
vi.mock('../../../lib/supabase', () => {
  const client = { from: () => h.b, rpc: () => h.b }
  return { supabase: client, db: client }
})

import {
  createCondominioRow,
  createCondominioRowReturning,
  upsertCondominioRow,
  updateCondominioRow,
  deleteCondominioRow,
  deleteCondominioRowBy,
  deleteCondominioRowsByIds,
  updateCondominioRowsByIds,
  marcarCuotasMorosas,
  firmarRecepcionPaquete,
  autorizarSalidaPaquete,
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

  it('upsertCondominioRow acepta lote (array) con onConflict', async () => {
    h.state.result = { error: null }
    expect(await upsertCondominioRow('historial_saldos_unidad', [{ a: 1 }, { a: 2 }], 'project_id,unidad_id,periodo'))
      .toEqual({ error: null })
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

  it('updateCondominioRowsByIds con lista vacía es no-op (no error)', async () => {
    h.state.result = { error: { message: 'no debería llamarse' } }
    expect(await updateCondominioRowsByIds('visitantes', [], { hora_salida: 'x' })).toEqual({ error: null })
  })

  it('updateCondominioRowsByIds aplica patch por .in y propaga error', async () => {
    h.state.result = { error: null }
    expect(await updateCondominioRowsByIds('visitantes', ['a', 'b'], { hora_salida: 'x' })).toEqual({ error: null })
    h.state.result = { error: { message: 'rls' } }
    expect(await updateCondominioRowsByIds('visitantes', ['a'], { hora_salida: 'x' })).toEqual({ error: { message: 'rls' } })
  })

  it('createCondominioRowReturning devuelve la fila creada (con select de embed)', async () => {
    h.state.result = { data: { id: 'p1', unidades: { nombre: 'A-1' } }, error: null }
    expect(await createCondominioRowReturning('paquetes_recibidos', {}, '*, unidades(nombre)'))
      .toEqual({ data: { id: 'p1', unidades: { nombre: 'A-1' } }, error: null })
  })

  it('firmarRecepcionPaquete (rpc) propaga el resultado', async () => {
    h.state.result = { error: null }
    expect(await firmarRecepcionPaquete('p1', 'path/firma.png', 'Ana')).toEqual({ error: null })
    h.state.result = { error: { message: 'no autorizado' } }
    expect(await firmarRecepcionPaquete('p1', 'path/firma.png', 'Ana')).toEqual({ error: { message: 'no autorizado' } })
  })

  it('autorizarSalidaPaquete (rpc) devuelve { data, error }', async () => {
    h.state.result = { data: { id: 'p1', codigo_retiro: 'ABC123' }, error: null }
    expect(await autorizarSalidaPaquete({
      unidadId: 'u1', tipo: 'paquete', descripcion: 'caja',
      autorizadoNombre: 'Ana', autorizadoDocumento: null, autorizadoTelefono: null,
      fotos: null, notas: null,
    })).toEqual({ data: { id: 'p1', codigo_retiro: 'ABC123' }, error: null })
  })
})
