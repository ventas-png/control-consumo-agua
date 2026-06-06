// T7/PR3 #1 — Contrato del acceso a presencia (presence/presence): el upsert del
// heartbeat (payload snake_case + onConflict) y la lectura activa que degrada a
// [] y aplica los filtros de scope. Mock encadenable que registra método+args.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state: { result: unknown; calls: Array<[string, unknown[]]> } = { result: { data: null }, calls: [] }
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'upsert', 'eq', 'gte']) {
    builder[m] = (...args: unknown[]) => { state.calls.push([m, args]); return builder }
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(state.result)
  return { state, builder }
})

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => h.builder } }))

import { upsertPresence, fetchActivePresence } from '../presence'

beforeEach(() => { h.state.result = { data: null }; h.state.calls = [] })

describe('upsertPresence', () => {
  it('mapea el latido a snake_case + onConflict user_id', async () => {
    await upsertPresence({ userId: 'u1', companyId: 'c1', projectId: null, section: 'tab', recordId: 'r1', lastSeen: 'T' })
    const up = h.state.calls.find(c => c[0] === 'upsert')
    expect(up?.[1][0]).toEqual({ user_id: 'u1', company_id: 'c1', project_id: null, section: 'tab', record_id: 'r1', last_seen: 'T' })
    expect(up?.[1][1]).toEqual({ onConflict: 'user_id' })
  })
  it('normaliza los opcionales ausentes a null', async () => {
    await upsertPresence({ userId: 'u1', companyId: 'c1', lastSeen: 'T' })
    expect(h.state.calls.find(c => c[0] === 'upsert')?.[1][0])
      .toMatchObject({ project_id: null, section: null, record_id: null })
  })
})

describe('fetchActivePresence', () => {
  it('degrada a [] cuando no hay data', async () => {
    h.state.result = { data: null }
    expect(await fetchActivePresence('c1', 'since')).toEqual([])
  })
  it('filtra por company_id y gte last_seen', async () => {
    h.state.result = { data: [{ user_id: 'u2' }] }
    expect(await fetchActivePresence('c1', '2026-01-01T00:00:00Z')).toEqual([{ user_id: 'u2' }])
    expect(h.state.calls.find(c => c[0] === 'eq')?.[1]).toEqual(['company_id', 'c1'])
    expect(h.state.calls.find(c => c[0] === 'gte')?.[1]).toEqual(['last_seen', '2026-01-01T00:00:00Z'])
  })
})
