// T7/PR3 — Contrato de las mutaciones de rutas (primera fila + mapeo de error).
import { describe, it, expect, vi } from 'vitest'

const insertSelect = vi.fn()
const updateSelect = vi.fn()
const deleteEq = vi.fn()
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      insert: () => ({ select: insertSelect }),
      update: () => ({ eq: () => ({ select: updateSelect }) }),
      delete: () => ({ eq: deleteEq }),
    }),
  },
}))

import { createRuta, updateRuta, deleteRuta } from '../mutations'

describe('rutas mutations', () => {
  it('createRuta éxito → devuelve la primera fila', async () => {
    insertSelect.mockResolvedValueOnce({ data: [{ id: 'r1' }], error: null })
    expect(await createRuta({})).toEqual({ data: { id: 'r1' }, error: null })
  })

  it('createRuta sin filas → data null', async () => {
    insertSelect.mockResolvedValueOnce({ data: [], error: null })
    expect(await createRuta({})).toEqual({ data: null, error: null })
  })

  it('createRuta error → { data: null, error: mensaje }', async () => {
    insertSelect.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    expect(await createRuta({})).toEqual({ data: null, error: 'boom' })
  })

  it('updateRuta éxito → primera fila', async () => {
    updateSelect.mockResolvedValueOnce({ data: [{ id: 'r1' }], error: null })
    expect(await updateRuta('r1', {})).toEqual({ data: { id: 'r1' }, error: null })
  })

  it('deleteRuta error → mensaje legible', async () => {
    deleteEq.mockResolvedValueOnce({ error: { message: 'fk violation' } })
    expect(await deleteRuta('r1')).toEqual({ error: 'fk violation' })
  })
})
