// T7/PR3 — Contrato de las mutaciones de contadores (fila + mapeo de error).
import { describe, it, expect, vi } from 'vitest'

const single = vi.fn()
const deleteEq = vi.fn()
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: () => ({ eq: () => ({ select: () => ({ single }) }) }),
      delete: () => ({ eq: deleteEq }),
    }),
  },
}))

import { updateContador, deleteContador } from '../mutations'

describe('contadores mutations', () => {
  it('updateContador éxito → devuelve la fila', async () => {
    single.mockResolvedValueOnce({ data: { id: 'c1' }, error: null })
    expect(await updateContador('c1', {})).toEqual({ data: { id: 'c1' }, error: null })
  })

  it('updateContador error → { data: null, error: mensaje }', async () => {
    single.mockResolvedValueOnce({ data: null, error: { message: 'bad' } })
    expect(await updateContador('c1', {})).toEqual({ data: null, error: 'bad' })
  })

  it('deleteContador error → mensaje legible', async () => {
    deleteEq.mockResolvedValueOnce({ error: { message: 'fk' } })
    expect(await deleteContador('c1')).toEqual({ error: 'fk' })
  })
})
