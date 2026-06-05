// T7/PR3 — Contrato de las mutaciones de unidades (fila + mapeo de error).
import { describe, it, expect, vi } from 'vitest'

const single = vi.fn()
const deleteEq = vi.fn()
const updateIn = vi.fn()
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      insert: () => ({ select: () => ({ single }) }),
      delete: () => ({ eq: deleteEq }),
      update: () => ({ in: updateIn }),
    }),
  },
}))

import { createUnidad, deleteUnidad, assignContadoresToUnidad } from '../mutations'

describe('unidades mutations', () => {
  it('createUnidad éxito → devuelve la fila', async () => {
    single.mockResolvedValueOnce({ data: { id: 'u1' }, error: null })
    expect(await createUnidad({})).toEqual({ data: { id: 'u1' }, error: null })
  })

  it('createUnidad error → { data: null, error: mensaje }', async () => {
    single.mockResolvedValueOnce({ data: null, error: { message: 'limit' } })
    expect(await createUnidad({})).toEqual({ data: null, error: 'limit' })
  })

  it('deleteUnidad error → mensaje legible', async () => {
    deleteEq.mockResolvedValueOnce({ error: { message: 'fk' } })
    expect(await deleteUnidad('u1')).toEqual({ error: 'fk' })
  })

  it('assignContadoresToUnidad éxito → { error: null }', async () => {
    updateIn.mockResolvedValueOnce({ error: null })
    expect(await assignContadoresToUnidad('u1', ['c1', 'c2'])).toEqual({ error: null })
  })
})
