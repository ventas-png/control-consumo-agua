// T7/PR3 #1 (Parte B) — Contrato del acceso a comunicados (comunicacion/
// broadcasts): enriquecimiento del conteo de lecturas, degradación a [], el
// update de "leído", y la edge create-broadcast (éxito / error / sin red).
// Mock encadenable que enruta el resultado por tabla y registra método+args.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state: {
    broadcasts: unknown
    recipients: unknown
    calls: Array<[string, string, unknown[]]>
  } = { broadcasts: { data: [], error: null }, recipients: { data: [], error: null }, calls: [] }
  const getSession = vi.fn()
  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'order', 'in', 'not', 'eq', 'update', 'is']) {
      b[m] = (...args: unknown[]) => { state.calls.push([table, m, args]); return b }
    }
    b.then = (resolve: (v: unknown) => void) =>
      resolve(table === 'broadcasts' ? state.broadcasts : state.recipients)
    return b
  }
  return { state, getSession, makeBuilder }
})

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: (table: string) => h.makeBuilder(table), auth: { getSession: h.getSession } },
}))

import {
  fetchBroadcastsWithReadCounts,
  createBroadcast,
  fetchClienteBroadcasts,
  markBroadcastRead,
} from '../broadcasts'

const fetchMock = vi.fn()
beforeEach(() => {
  h.state.broadcasts = { data: [], error: null }
  h.state.recipients = { data: [], error: null }
  h.state.calls = []
  h.getSession.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('fetchBroadcastsWithReadCounts', () => {
  it('enriquece read_count por comunicado', async () => {
    h.state.broadcasts = { data: [{ id: 'b1' }, { id: 'b2' }], error: null }
    h.state.recipients = { data: [{ broadcast_id: 'b1' }, { broadcast_id: 'b1' }], error: null }
    const out = await fetchBroadcastsWithReadCounts()
    expect(out).toEqual([{ id: 'b1', read_count: 2 }, { id: 'b2', read_count: 0 }])
  })
  it('lanza si falla la lectura principal', async () => {
    h.state.broadcasts = { data: null, error: { message: 'denied' } }
    await expect(fetchBroadcastsWithReadCounts()).rejects.toBeTruthy()
  })
})

describe('createBroadcast', () => {
  const params = { title: 't', body: 'b', target_type: 'all' as never, target_ids: [], send_email: true }
  it('éxito → success con conteos', async () => {
    h.getSession.mockResolvedValueOnce({ data: { session: { access_token: 'tok' } } })
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, recipientCount: 5, emailsQueued: 3 }) })
    expect(await createBroadcast(params)).toEqual({ success: true, recipientCount: 5, emailsQueued: 3 })
  })
  it('!ok → success:false con el error de la edge', async () => {
    h.getSession.mockResolvedValueOnce({ data: { session: null } })
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'boom' }) })
    expect(await createBroadcast(params)).toEqual({ success: false, recipientCount: 0, emailsQueued: 0, error: 'boom' })
  })
  it('sin red → mensaje de conexión', async () => {
    h.getSession.mockResolvedValueOnce({ data: { session: { access_token: 'tok' } } })
    fetchMock.mockRejectedValueOnce(new Error('network'))
    expect(await createBroadcast(params)).toEqual({
      success: false, recipientCount: 0, emailsQueued: 0, error: 'No se pudo conectar con el servidor.',
    })
  })
})

describe('fetchClienteBroadcasts', () => {
  it('degrada a [] si hay error', async () => {
    h.state.recipients = { data: null, error: { message: 'x' } }
    expect(await fetchClienteBroadcasts('c1')).toEqual([])
    expect(h.state.calls.find(c => c[1] === 'eq')?.[2]).toEqual(['cliente_id', 'c1'])
  })
  it('devuelve las filas', async () => {
    h.state.recipients = { data: [{ id: 'r1' }], error: null }
    expect(await fetchClienteBroadcasts('c1')).toEqual([{ id: 'r1' }])
  })
})

describe('markBroadcastRead', () => {
  it('manda read_at y filtra por id + read_at null', async () => {
    await markBroadcastRead('r1', '2026-01-01T00:00:00Z')
    expect(h.state.calls.find(c => c[1] === 'update')?.[2][0]).toEqual({ read_at: '2026-01-01T00:00:00Z' })
    expect(h.state.calls.find(c => c[1] === 'eq')?.[2]).toEqual(['id', 'r1'])
    expect(h.state.calls.find(c => c[1] === 'is')?.[2]).toEqual(['read_at', null])
  })
})
