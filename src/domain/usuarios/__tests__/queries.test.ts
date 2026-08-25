// T7/PR3 — Contrato de las lecturas de usuarios (app_users).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { eqFn, inFn, rpcFn } = vi.hoisted(() => ({ eqFn: vi.fn(), inFn: vi.fn(), rpcFn: vi.fn() }))
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: eqFn, in: inFn }) }),
    rpc: rpcFn,
  },
}))

import { fetchActiveAppUsers, fetchAppUserNamesByIds, fetchOperadoresAsignablesRuta } from '../queries'

beforeEach(() => { eqFn.mockReset(); inFn.mockReset(); rpcFn.mockReset() })

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

describe('fetchOperadoresAsignablesRuta', () => {
  it('pide el catálogo del PROYECTO, no el de la empresa', async () => {
    // El operador de otro condominio no puede leer los contadores de este: si
    // el selector lo ofrece, la ruta queda con un responsable que no puede
    // ejecutarla.
    rpcFn.mockResolvedValueOnce({ data: [{ id: 'u1', full_name: 'Ana', role: 'operator', activo: true }], error: null })
    const r = await fetchOperadoresAsignablesRuta('p1')
    expect(rpcFn).toHaveBeenCalledWith('rutas_operadores_asignables', { p_project_id: 'p1' })
    expect(r).toEqual([{ id: 'u1', full_name: 'Ana', role: 'operator', activo: true }])
  })
  it('data null → []', async () => {
    rpcFn.mockResolvedValueOnce({ data: null, error: { message: 'No autorizado' } })
    expect(await fetchOperadoresAsignablesRuta('p1')).toEqual([])
  })
})
