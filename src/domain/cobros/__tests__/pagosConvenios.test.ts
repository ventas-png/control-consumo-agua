// T7/PR3 — Contrato de los cobros MANUALES (pagos/convenios): fetch + mapeo de
// error. Distinto de mutations.test.ts (que prueba el patch builder PURO de
// payfac); aquí mockeamos `from()` porque estas funciones sí tocan tablas.
import { describe, it, expect, vi } from 'vitest'

const order = vi.fn()
const insert = vi.fn()
const updateEq = vi.fn()
vi.mock('../../../lib/supabase', () => {
  const client = {
    from: () => ({
      // fetchPagosYConvenios: pagos usa .select().is().order(); convenios .select().order()
      select: () => ({
        is: () => ({ order }),
        order,
      }),
      insert,
      update: () => ({ eq: updateEq }),
    }),
  }
  // Como en el módulo real, `db` es la MISMA instancia vista con el esquema tipado.
  return { supabase: client, db: client }
})

import { fetchPagosYConvenios } from '../queries'
import { createPago, verifyPago, rejectPago, createConvenio, setConvenioEstado } from '../mutations'

describe('fetchPagosYConvenios', () => {
  it('devuelve pagos + convenios', async () => {
    order
      .mockResolvedValueOnce({ data: [{ id: 'p1' }] }) // pagos (1er query del Promise.all)
      .mockResolvedValueOnce({ data: [{ id: 'c1' }] }) // convenios (2do)
    expect(await fetchPagosYConvenios()).toEqual({
      pagos: [{ id: 'p1' }],
      // La frontera tipada normaliza registro_ids null → [] (el dominio lo exige no-null).
      convenios: [{ id: 'c1', registro_ids: [] }],
    })
  })

  it('data null → defaultea a arreglos vacíos', async () => {
    order
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ data: null })
    expect(await fetchPagosYConvenios()).toEqual({ pagos: [], convenios: [] })
  })
})

describe('cobros manuales — mutaciones', () => {
  it('createPago éxito → { error: null }', async () => {
    insert.mockResolvedValueOnce({ error: null })
    expect(await createPago({})).toEqual({ error: null })
  })

  it('createPago error → mensaje legible', async () => {
    insert.mockResolvedValueOnce({ error: { message: 'no insert' } })
    expect(await createPago({})).toEqual({ error: 'no insert' })
  })

  it('verifyPago éxito → { error: null }', async () => {
    updateEq.mockResolvedValueOnce({ error: null })
    expect(await verifyPago('pago1', 'user1')).toEqual({ error: null })
  })

  it('rejectPago propaga el error', async () => {
    updateEq.mockResolvedValueOnce({ error: { message: 'denied' } })
    expect(await rejectPago('pago1', 'user1', 'motivo')).toEqual({ error: 'denied' })
  })

  it('createConvenio éxito → { error: null }', async () => {
    insert.mockResolvedValueOnce({ error: null })
    expect(await createConvenio({})).toEqual({ error: null })
  })

  it('setConvenioEstado éxito → { error: null }', async () => {
    updateEq.mockResolvedValueOnce({ error: null })
    expect(await setConvenioEstado('c1', 'completado')).toEqual({ error: null })
  })
})
