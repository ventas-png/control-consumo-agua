// T7/PR3 — Contrato de createRegistro (primera fila + mapeo de error).
import { describe, it, expect, vi } from 'vitest'

const insertSelect = vi.fn()
vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => ({ insert: () => ({ select: insertSelect }) }) },
}))

import { createRegistro } from '../mutations'

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
