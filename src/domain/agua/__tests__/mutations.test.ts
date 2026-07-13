// T7/PR3 — Contrato de las mutaciones de agua (registros): fila + mapeo de error.
import { describe, it, expect, vi } from 'vitest'

const insertSelect = vi.fn()
const updateEq = vi.fn()
const updateIn = vi.fn()
const deleteEq = vi.fn()
const storageUpload = vi.fn()
vi.mock('../../../lib/supabase', () => {
  // `db` es la MISMA instancia que `supabase` (cast tipado) — el mock replica eso.
  const client = {
    from: () => ({
      insert: () => ({ select: insertSelect }),
      update: () => ({ eq: updateEq, in: updateIn }),
      delete: () => ({ eq: deleteEq }),
    }),
    storage: { from: () => ({ upload: storageUpload }) },
  }
  return { supabase: client, db: client }
})

import { createRegistro, updateRegistro, deleteRegistro, marcarRegistrosMora, uploadRegistroFoto } from '../mutations'

describe('createRegistro', () => {
  it('éxito → devuelve la primera fila', async () => {
    insertSelect.mockResolvedValueOnce({ data: [{ id: 'reg1' }], error: null })
    expect(await createRegistro({})).toEqual({ data: { id: 'reg1' }, error: null })
  })

  it('error → { data: null, error: mensaje }', async () => {
    insertSelect.mockResolvedValueOnce({ data: null, error: { message: 'bad insert' } })
    expect(await createRegistro({})).toEqual({ data: null, error: 'bad insert' })
  })
})

describe('updateRegistro', () => {
  it('éxito → { error: null }', async () => {
    updateEq.mockResolvedValueOnce({ error: null })
    expect(await updateRegistro('reg1', { estado: 'pagado' })).toEqual({ error: null })
  })

  it('error → mensaje legible', async () => {
    updateEq.mockResolvedValueOnce({ error: { message: 'denied' } })
    expect(await updateRegistro('reg1', {})).toEqual({ error: 'denied' })
  })
})

describe('deleteRegistro', () => {
  it('éxito → { error: null, count }', async () => {
    deleteEq.mockResolvedValueOnce({ error: null, count: 1 })
    expect(await deleteRegistro('reg1')).toEqual({ error: null, count: 1 })
  })

  it('sin permisos (count 0, sin error) → distingue del borrado', async () => {
    deleteEq.mockResolvedValueOnce({ error: null, count: 0 })
    expect(await deleteRegistro('reg1')).toEqual({ error: null, count: 0 })
  })

  it('error → mensaje legible y count null', async () => {
    deleteEq.mockResolvedValueOnce({ error: { message: 'denied' }, count: null })
    expect(await deleteRegistro('reg1')).toEqual({ error: 'denied', count: null })
  })
})

describe('marcarRegistrosMora', () => {
  it('éxito → { error: null }', async () => {
    updateIn.mockResolvedValueOnce({ error: null })
    expect(await marcarRegistrosMora(['a', 'b'])).toEqual({ error: null })
  })

  it('error → mensaje legible', async () => {
    updateIn.mockResolvedValueOnce({ error: { message: 'rls' } })
    expect(await marcarRegistrosMora(['a'])).toEqual({ error: 'rls' })
  })
})

describe('uploadRegistroFoto', () => {
  it('éxito → { error: null }', async () => {
    storageUpload.mockResolvedValueOnce({ error: null })
    expect(await uploadRegistroFoto('c1/123', new Blob(['x']), 'image/png')).toEqual({ error: null })
  })

  it('error → mensaje legible', async () => {
    storageUpload.mockResolvedValueOnce({ error: { message: 'too big' } })
    expect(await uploadRegistroFoto('c1/123', new Blob(['x']))).toEqual({ error: 'too big' })
  })
})
