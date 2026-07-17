// T7/PR3 — Contrato de las mutaciones de agua (registros): fila + mapeo de error.
import { describe, it, expect, vi } from 'vitest'

const insertSelect = vi.fn()
const updateEq = vi.fn()
const updateIn = vi.fn()
// E2: deleteRegistro es soft delete — va por softDelete() (update + match + is).
const softDeleteIs = vi.fn()
const storageUpload = vi.fn()
vi.mock('../../../lib/supabase', () => {
  // `db` es la MISMA instancia que `supabase` (cast tipado) — el mock replica eso.
  const client = {
    from: () => ({
      insert: () => ({ select: insertSelect }),
      update: () => ({ eq: updateEq, in: updateIn, match: () => ({ is: softDeleteIs }) }),
    }),
    storage: { from: () => ({ upload: storageUpload }) },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
  }
  return { supabase: client, db: client }
})

import { createRegistro, updateRegistro, deleteRegistro, marcarRegistrosMora, uploadRegistroFoto } from '../mutations'

describe('createRegistro', () => {
  it('éxito → devuelve la primera fila', async () => {
    insertSelect.mockResolvedValueOnce({ data: [{ id: 'reg1' }], error: null })
    expect(await createRegistro({})).toEqual({ data: { id: 'reg1' }, error: null, duplicado: false })
  })

  it('error → { data: null, error: mensaje }', async () => {
    insertSelect.mockResolvedValueOnce({ data: null, error: { message: 'bad insert' } })
    expect(await createRegistro({})).toEqual({ data: null, error: 'bad insert', duplicado: false })
  })

  it('E1: 23505 (llave natural) → duplicado true con mensaje amigable', async () => {
    insertSelect.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_registros_llave_natural"' },
    })
    const r = await createRegistro({})
    expect(r.duplicado).toBe(true)
    expect(r.data).toBeNull()
    expect(r.error).toContain('ya está registrada')
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

describe('deleteRegistro (soft delete, E2)', () => {
  it('éxito → { error: null, count } vía softDelete (update, no DELETE físico)', async () => {
    softDeleteIs.mockResolvedValueOnce({ error: null, count: 1 })
    expect(await deleteRegistro('reg1')).toEqual({ error: null, count: 1 })
    expect(softDeleteIs).toHaveBeenCalledWith('deleted_at', null)
  })

  it('sin permisos o ya borrado (count 0, sin error) → distingue del borrado', async () => {
    softDeleteIs.mockResolvedValueOnce({ error: null, count: 0 })
    expect(await deleteRegistro('reg1')).toEqual({ error: null, count: 0 })
  })

  it('error → mensaje legible y count null', async () => {
    softDeleteIs.mockResolvedValueOnce({ error: { message: 'denied' }, count: null })
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
