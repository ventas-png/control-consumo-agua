import { describe, it, expect, vi } from 'vitest'

// Stub del cliente Supabase: mutations.ts lo importa para los writes, pero esta
// suite solo ejercita los helpers PUROS (sin red). Evita el throw de env vars al
// cargar el módulo. Mismo patrón que validatedInsert.test.ts. `db` es la MISMA
// instancia que `supabase` (cast tipado) — el mock replica eso.
vi.mock('../../../lib/supabase', () => {
  const client = { from: () => { throw new Error('default client should not be used in pure-logic tests') } }
  return { supabase: client, db: client }
})

import {
  particionarEmitibles,
  TransicionInvalidaError,
} from '../mutations'

// Lo que queda de PURO en este módulo tras 20260910235732. El snapshot de IVA, el
// vencimiento y el abonado los calculaba `buildEmitirFacturaPatch` aquí y se
// mandaban como `UPDATE`; ahora los calcula el servidor dentro de
// `agua_factura_emitir` / `_registrar_pago`, y sus números los verifica
// supabase/tests/proteger_update_registros/ contra un Postgres real. Aquí sobrevive
// el gating de la UI: qué se ofrece y qué se omite, que sigue siendo del cliente.


describe('TransicionInvalidaError', () => {
  it('conserva la acción y el estado actual para diagnóstico', () => {
    const err = new TransicionInvalidaError('pagada', 'emitir')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('TransicionInvalidaError')
    expect(err.accion).toBe('emitir')
    expect(err.estadoActual).toBe('pagada')
  })
})

describe('particionarEmitibles', () => {
  it('separa pendientes (emitibles) de terminales/emitidas (omitidas)', () => {
    const { emitibles, omitidas } = particionarEmitibles([
      { id: 'a', factura_estado: 'pendiente' },
      { id: 'b', factura_estado: null },        // sin factura → pendiente → emitible
      { id: 'c', factura_estado: 'emitida' },   // ya emitida → omitida
      { id: 'd', factura_estado: 'pagada' },    // terminal → omitida
      { id: 'e', factura_estado: 'anulada' },   // terminal → omitida
      { id: 'f', factura_estado: 'vencida' },   // vencida no re-emite → omitida
    ])
    expect(emitibles.map(x => x.id)).toEqual(['a', 'b'])
    expect(omitidas.map(x => x.id)).toEqual(['c', 'd', 'e', 'f'])
  })

  it('normaliza estados legacy (pendiente emitible; mora=vencida no)', () => {
    const { emitibles, omitidas } = particionarEmitibles([
      { id: 'a', factura_estado: 'mora' },   // legacy → vencida → omitida
      { id: 'b', factura_estado: 'pagado' }, // legacy → pagada → omitida
    ])
    expect(emitibles).toHaveLength(0)
    expect(omitidas.map(x => x.id)).toEqual(['a', 'b'])
  })

  it('set vacío → ambas listas vacías', () => {
    expect(particionarEmitibles([])).toEqual({ emitibles: [], omitidas: [] })
  })
})
