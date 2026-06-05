// T7/PR3 — Contrato de las mutaciones de calidad (mapeo de error que la UI usa).
import { describe, it, expect, vi } from 'vitest'

const insert = vi.fn()
const updateEq = vi.fn()
vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => ({ insert, update: () => ({ eq: updateEq }) }) },
}))

import { createFuente, createRegistroCalidad, setFuenteActiva } from '../mutations'

describe('calidad mutations', () => {
  it('createFuente éxito → { error: null }', async () => {
    insert.mockResolvedValueOnce({ error: null })
    expect(await createFuente({})).toEqual({ error: null })
  })

  it('createFuente falla → { error: mensaje }', async () => {
    insert.mockResolvedValueOnce({ error: { message: 'dup identificador' } })
    expect(await createFuente({})).toEqual({ error: 'dup identificador' })
  })

  it('createRegistroCalidad éxito', async () => {
    insert.mockResolvedValueOnce({ error: null })
    expect(await createRegistroCalidad({})).toEqual({ error: null })
  })

  it('setFuenteActiva error → mensaje', async () => {
    updateEq.mockResolvedValueOnce({ error: { message: 'rls' } })
    expect(await setFuenteActiva('f1', false)).toEqual({ error: 'rls' })
  })
})
