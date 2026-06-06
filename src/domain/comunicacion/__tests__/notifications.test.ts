// T7/PR3 #1 — Contrato del feed de notificaciones (comunicacion/notifications):
// la lectura degrada a [] y respeta el limit; los marcadores de leído mandan el
// patch correcto y filtran por eq/in. Mock encadenable que registra método+args.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state: { result: unknown; calls: Array<[string, unknown[]]> } = { result: { data: null }, calls: [] }
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'update', 'order', 'limit', 'eq', 'in']) {
    builder[m] = (...args: unknown[]) => { state.calls.push([m, args]); return builder }
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(state.result)
  return { state, builder }
})

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => h.builder } }))

import { fetchUserNotifications, markNotificationRead, markNotificationsRead } from '../notifications'

beforeEach(() => { h.state.result = { data: null }; h.state.calls = [] })

describe('fetchUserNotifications', () => {
  it('degrada a [] cuando no hay data', async () => {
    h.state.result = { data: null }
    expect(await fetchUserNotifications(30)).toEqual([])
  })
  it('devuelve las filas y respeta el limit', async () => {
    h.state.result = { data: [{ id: 'n1' }] }
    expect(await fetchUserNotifications(30)).toEqual([{ id: 'n1' }])
    expect(h.state.calls.find(c => c[0] === 'limit')?.[1]).toEqual([30])
  })
})

describe('markNotificationRead', () => {
  it('manda leido:true + leido_at y filtra por id', async () => {
    await markNotificationRead('n1', '2026-01-01T00:00:00Z')
    expect(h.state.calls.find(c => c[0] === 'update')?.[1][0])
      .toMatchObject({ leido: true, leido_at: '2026-01-01T00:00:00Z' })
    expect(h.state.calls.find(c => c[0] === 'eq')?.[1]).toEqual(['id', 'n1'])
  })
})

describe('markNotificationsRead', () => {
  it('no-op si la lista está vacía (no toca supabase)', async () => {
    await markNotificationsRead([], 'x')
    expect(h.state.calls.length).toBe(0)
  })
  it('usa .in con los ids', async () => {
    await markNotificationsRead(['a', 'b'], '2026-01-01T00:00:00Z')
    expect(h.state.calls.find(c => c[0] === 'in')?.[1]).toEqual(['id', ['a', 'b']])
  })
})
