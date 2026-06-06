// T7 follow-up — contrato de fetchCompanyEffectiveLimits / fetchCompanyUsage
// (extraen la primera fila de la RPC + mapean error).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc } }))

import { fetchCompanyEffectiveLimits, fetchCompanyUsage } from '../queries'

beforeEach(() => rpc.mockReset())

describe('fetchCompanyEffectiveLimits', () => {
  it('devuelve la primera fila', async () => {
    rpc.mockResolvedValueOnce({ data: [{ max_projects: 5, max_units: 50 }], error: null })
    expect(await fetchCompanyEffectiveLimits('co1')).toEqual({ data: { max_projects: 5, max_units: 50 }, error: null })
  })
  it('error → { data: null, error: mensaje }', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'no autorizado' } })
    expect(await fetchCompanyEffectiveLimits('co1')).toEqual({ data: null, error: 'no autorizado' })
  })
})

describe('fetchCompanyUsage', () => {
  it('devuelve la primera fila', async () => {
    rpc.mockResolvedValueOnce({ data: [{ projects_count: 2, units_count: 10 }], error: null })
    expect(await fetchCompanyUsage('co1')).toEqual({ data: { projects_count: 2, units_count: 10 }, error: null })
  })
  it('sin filas → data null', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null })
    expect(await fetchCompanyUsage('co1')).toEqual({ data: null, error: null })
  })
})
