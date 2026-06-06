// T7/PR3 — Contrato de las lecturas de usuarios (app_users).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { eqFn, inFn } = vi.hoisted(() => ({ eqFn: vi.fn(), inFn: vi.fn() }))
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: eqFn, in: inFn }) }),
  },
}))

import { fetchActiveAppUsers, fetchAppUserNamesByIds } from '../queries'

beforeEach(() => { eqFn.mockReset(); inFn.mockReset() })

describe('fetchActiveAppUsers', () => {
  it('devuelve los usuarios activos', async () => {
    eqFn.mockResolvedValueOnce({ data: [{ id: 'u1', full_name: 'A', role: 'admin', activo: true }] })
    expect(await fetchActiveAppUsers()).toEqual([{ id: 'u1', full_name: 'A', role: 'admin', activo: true }])
  })
  it('data null → []', async () => {
    eqFn.mockResolvedValueOnce({ data: null })
    expect(await fetchActiveAppUsers()).toEqual([])
  })
})

describe('fetchAppUserNamesByIds', () => {
  it('devuelve id + full_name', async () => {
    inFn.mockResolvedValueOnce({ data: [{ id: 'u1', full_name: 'Ana' }] })
    expect(await fetchAppUserNamesByIds(['u1'])).toEqual([{ id: 'u1', full_name: 'Ana' }])
  })
  it('data null → []', async () => {
    inFn.mockResolvedValueOnce({ data: null })
    expect(await fetchAppUserNamesByIds(['u1'])).toEqual([])
  })
})
