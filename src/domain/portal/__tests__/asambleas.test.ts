// domain/portal/asambleas — el contrato con los RPC de 20261105000000.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  rpc: vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: null as unknown, error: null as { message: string; code?: string } | null })),
}))
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: h.rpc } }))

const { fetchAsambleasUnidad, votarPunto } = await import('../asambleas')

beforeEach(() => h.rpc.mockClear())

describe('fetchAsambleasUnidad', () => {
  it('llama portal_asambleas_unidad con la unidad y devuelve las filas', async () => {
    h.rpc.mockResolvedValueOnce({ data: [{ id: 'a1', puntos: [] }], error: null })
    expect(await fetchAsambleasUnidad('u1')).toEqual({ data: [{ id: 'a1', puntos: [] }], error: null })
    expect(h.rpc).toHaveBeenCalledWith('portal_asambleas_unidad', { p_unidad_id: 'u1' })
  })
  it('con error devuelve [] y el mensaje', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    expect(await fetchAsambleasUnidad('u1')).toEqual({ data: [], error: 'boom' })
  })
})

describe('votarPunto', () => {
  it('llama portal_votar_punto con punto, unidad y voto', async () => {
    expect(await votarPunto('p1', 'u1', 'en_contra')).toEqual({ error: null, yaVotado: false })
    expect(h.rpc).toHaveBeenCalledWith('portal_votar_punto', { p_punto_id: 'p1', p_unidad_id: 'u1', p_voto: 'en_contra' })
  })
  it('el 23505 del servidor es «ya votó»', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Esta unidad ya votó en este punto.', code: '23505' } })
    expect(await votarPunto('p1', 'u1', 'a_favor')).toEqual({ error: 'Esta unidad ya votó en este punto.', yaVotado: true })
  })
  it('otro error no es «ya votó»', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Solo el propietario de la unidad puede votar.', code: '42501' } })
    expect(await votarPunto('p1', 'u1', 'a_favor')).toEqual({ error: 'Solo el propietario de la unidad puede votar.', yaVotado: false })
  })
})
