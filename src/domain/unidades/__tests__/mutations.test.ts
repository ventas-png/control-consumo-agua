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

import { createUnidad, deleteUnidad, assignContadoresToUnidad, mensajeBorradoUnidad } from '../mutations'

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

  it('deleteUnidad con historial de recepción → dice qué hacer', async () => {
    deleteEq.mockResolvedValueOnce({ error: {
      code: '23503',
      message: 'update or delete on table "unidades" violates foreign key constraint '
        + '"paquetes_recibidos_unidad_id_fkey" on table "paquetes_recibidos"',
    } })
    const { error } = await deleteUnidad('u1')
    expect(String(error)).toMatch(/historial de recepción/)
    expect(String(error)).toMatch(/[Dd]esactívala/)
  })

  it('assignContadoresToUnidad éxito → { error: null }', async () => {
    updateIn.mockResolvedValueOnce({ error: null })
    expect(await assignContadoresToUnidad('u1', ['c1', 'c2'])).toEqual({ error: null })
  })
})

// ── El FK que dejó de ser SET NULL ──────────────────────────────────────────
// `paquetes_recibidos.unidad_id` es RESTRICT desde 20260901000000: antes era
// SET NULL y chocaba con los CHECK que exigen unidad_id, así que borrar una
// unidad con historial abortaba con un 23514 que no le decía nada a nadie.
describe('mensajeBorradoUnidad', () => {
  const fkRecepcion = {
    code: '23503',
    message: 'update or delete on table "unidades" violates foreign key constraint '
      + '"paquetes_recibidos_unidad_id_fkey" on table "paquetes_recibidos"',
  }

  it('sin error, no hay mensaje', () => {
    expect(mensajeBorradoUnidad(null)).toBeNull()
  })

  it('nombra el historial de recepción y la salida: desactivar', () => {
    const m = String(mensajeBorradoUnidad(fkRecepcion))
    expect(m).toMatch(/historial de recepción/)
    expect(m).toMatch(/paquetes o correspondencia/)
    expect(m).toMatch(/[Dd]esactívala/)
    // Y no le echa encima el SQL crudo.
    expect(m).not.toMatch(/foreign key constraint/)
  })

  it('lo detecta también sin código, por el texto de Postgres', () => {
    expect(String(mensajeBorradoUnidad({ message: fkRecepcion.message })))
      .toMatch(/historial de recepción/)
  })

  it('otro FK distinto tiene su propio mensaje, también accionable', () => {
    const m = String(mensajeBorradoUnidad({
      code: '23503',
      message: 'violates foreign key constraint "contratos_unidad_id_fkey" on table "contratos"',
    }))
    expect(m).toMatch(/registros asociados/)
    expect(m).toMatch(/[Dd]esactívala/)
    expect(m).not.toMatch(/recepción/)
  })

  it('un error que no es de FK se pasa tal cual', () => {
    expect(mensajeBorradoUnidad({ code: '42501', message: 'permission denied' })).toBe('permission denied')
  })
})
