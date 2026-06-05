// T7/PR3 — Test del contrato de deleteTarifa (mapeo de error que la UI consume).
import { describe, it, expect, vi } from 'vitest'

const eq = vi.fn()
// Stub del chain supabase.from('tarifas').delete().eq('id', id) — sin red/env.
vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => ({ delete: () => ({ eq }) }) },
}))

import { deleteTarifa } from '../mutations'

describe('deleteTarifa', () => {
  it('éxito → { error: null }', async () => {
    eq.mockResolvedValueOnce({ error: null })
    expect(await deleteTarifa('t1')).toEqual({ error: null })
  })

  it('falla → { error: <mensaje> } (lo que la UI muestra)', async () => {
    eq.mockResolvedValueOnce({ error: { message: 'violates foreign key' } })
    expect(await deleteTarifa('t1')).toEqual({ error: 'violates foreign key' })
  })
})
