// T7/PR3 — Contrato de los cobros MANUALES (pagos/convenios): fetch + mapeo de
// error. Distinto de mutations.test.ts (que prueba el patch builder PURO de
// payfac); aquí mockeamos `from()` porque estas funciones sí tocan tablas.
import { describe, it, expect, vi } from 'vitest'

const order = vi.fn()
const insert = vi.fn()
const updateEq = vi.fn()
/** Cuerpo de cada `.update()`, en orden. */
const updates: unknown[] = []
/** Filtros `.is(col, valor)` que recibió cada consulta, por tabla. */
const filtrosIs: Record<string, [string, unknown][]> = {}
/** Respuesta de `conta_anticipos` (20261007000000): se lee sin filtros. */
let anticipos: { data: unknown; error: unknown } = { data: [], error: null }
vi.mock('../../../lib/supabase', () => {
  const client = {
    from: (tabla: string) => {
      filtrosIs[tabla] = []
      // fetchPagosYConvenios: pagos usa .select().is().is().order(); convenios .select().order()
      const conFiltros = {
        is: (col: string, valor: unknown) => { filtrosIs[tabla].push([col, valor]); return conFiltros },
        order,
      }
      return {
        select: () => (tabla === 'conta_anticipos' ? Promise.resolve(anticipos) : conFiltros),
        insert,
        update: (cuerpo: unknown) => { updates.push(cuerpo); return { eq: updateEq } },
      }
    },
  }
  // Como en el módulo real, `db` es la MISMA instancia vista con el esquema tipado.
  return { supabase: client, db: client }
})

import { fetchPagosYConvenios, esCobroDeCargoAdicional } from '../queries'
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

  it('pide al servidor sólo pagos vivos y sin cargo adicional; convenios sin tocar', async () => {
    order
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
    await fetchPagosYConvenios()
    expect(filtrosIs.pagos).toEqual([['deleted_at', null], ['cargo_adicional_id', null]])
    // Ni company_id ni project_id: el aislamiento sigue siendo el de la RLS.
    expect(filtrosIs.convenios_pago).toEqual([])
  })

  it('si un cobro de cargo llegara igual, la frontera lo descarta; agua, cuotas y convenios siguen', async () => {
    order
      .mockResolvedValueOnce({
        data: [
          { id: 'agua', registro_id: 'r1', cargo_adicional_id: null, monto: 100 },
          { id: 'cuota', cuota_id: 'q1', cargo_adicional_id: null, monto: 50 },
          { id: 'convenio', convenio_id: 'cv1', cargo_adicional_id: null, monto: 30 },
          // Concepto y referencia «de agua» a propósito: se decide por el vínculo.
          { id: 'cargo', cargo_adicional_id: 'ca1', referencia: 'Agua enero', notas: 'agua', monto: 999 },
        ],
      })
      .mockResolvedValueOnce({ data: [{ id: 'c1', registro_ids: ['r1'] }] })
    const { pagos, convenios } = await fetchPagosYConvenios()
    expect(pagos.map(p => p.id)).toEqual(['agua', 'cuota', 'convenio'])
    expect(convenios).toEqual([{ id: 'c1', registro_ids: ['r1'] }])
  })
})

describe('fetchPagosYConvenios · anticipos (20261007000000)', () => {
  it('un anticipo no aparece entre los cobros de agua: es saldo a favor y se gestiona en Contabilidad', async () => {
    anticipos = { data: [{ pago_id: 'anticipo' }], error: null }
    order
      .mockResolvedValueOnce({ data: [
        { id: 'agua', registro_id: 'r1', cargo_adicional_id: null, monto: 100 },
        { id: 'anticipo', cargo_adicional_id: null, monto: 60 },
      ] })
      .mockResolvedValueOnce({ data: [] })
    const { pagos } = await fetchPagosYConvenios()
    expect(pagos.map(p => p.id)).toEqual(['agua'])
    anticipos = { data: [], error: null }
  })

  it('si la lista de anticipos no se puede leer, la pantalla no se cae', async () => {
    anticipos = { data: null, error: { message: 'sin permiso' } }
    order
      .mockResolvedValueOnce({ data: [{ id: 'agua', registro_id: 'r1', cargo_adicional_id: null, monto: 100 }] })
      .mockResolvedValueOnce({ data: [] })
    const { pagos } = await fetchPagosYConvenios()
    expect(pagos.map(p => p.id)).toEqual(['agua'])
    anticipos = { data: [], error: null }
  })
})

describe('esCobroDeCargoAdicional', () => {
  it('sólo el vínculo explícito cuenta', () => {
    expect(esCobroDeCargoAdicional({ cargo_adicional_id: 'ca1' })).toBe(true)
    expect(esCobroDeCargoAdicional({ cargo_adicional_id: null })).toBe(false)
    expect(esCobroDeCargoAdicional({})).toBe(false)
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
    expect(await rejectPago('pago1', 'motivo')).toEqual({ error: 'denied' })
  })

  it('rejectPago no reescribe la verificación: sólo estado y motivo', async () => {
    updates.length = 0
    updateEq.mockResolvedValueOnce({ error: null })
    expect(await rejectPago('pago1', 'comprobante ilegible')).toEqual({ error: null })
    expect(updates).toEqual([{ verification_status: 'rechazado', estado: 'rechazado', verification_notes: 'comprobante ilegible' }])
    expect(updateEq).toHaveBeenLastCalledWith('id', 'pago1')
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
