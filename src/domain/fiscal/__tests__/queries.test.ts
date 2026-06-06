// T7/PR3 — Contrato de fetchProjectFiscalOverride: lee las columnas fiscales no
// secretas de projects vía runQuery (abortSignal) y devuelve la fila o null.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state: { result: unknown } = { result: { data: null, error: null } }
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'limit', 'abortSignal']) builder[m] = () => builder
  builder.then = (resolve: (v: unknown) => void) => resolve(state.result)
  return { state, builder }
})

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => h.builder } }))

import { fetchProjectFiscalOverride } from '../queries'

beforeEach(() => { h.state.result = { data: null, error: null } })

describe('fetchProjectFiscalOverride', () => {
  it('con fila → devuelve la primera', async () => {
    h.state.result = { data: [{ regimen_fiscal: 'general', nit: '123' }], error: null }
    expect(await fetchProjectFiscalOverride('p1')).toEqual({ regimen_fiscal: 'general', nit: '123' })
  })

  it('sin filas → null', async () => {
    h.state.result = { data: [], error: null }
    expect(await fetchProjectFiscalOverride('p1')).toBeNull()
  })

  it('error → lanza (runQuery)', async () => {
    h.state.result = { data: null, error: { message: 'rls' } }
    await expect(fetchProjectFiscalOverride('p1')).rejects.toThrow('rls')
  })
})
