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
  calcularFechaVencimiento,
  buildEmitirFacturaPatch,
  particionarEmitibles,
  TransicionInvalidaError,
} from '../mutations'

// Estas pruebas cubren la lógica PURA que introducen las mutaciones (construcción
// del parche a persistir). La máquina de estados y los cálculos de IVA/total/mora
// ya están testeados en src/lib/__tests__/business.test.ts — aquí verificamos que
// la orquestación los compone correctamente y respeta el gating de transición.

describe('calcularFechaVencimiento', () => {
  it('suma N días a la fecha base y devuelve YYYY-MM-DD', () => {
    expect(calcularFechaVencimiento('2026-06-04T10:00:00.000Z', 30)).toBe('2026-07-04')
  })

  it('0 días devuelve el mismo día', () => {
    expect(calcularFechaVencimiento('2026-06-04T10:00:00.000Z', 0)).toBe('2026-06-04')
  })

  it('cruza fin de mes correctamente', () => {
    expect(calcularFechaVencimiento('2026-01-20T00:00:00.000Z', 15)).toBe('2026-02-04')
  })

  it('días no finitos se tratan como 0', () => {
    expect(calcularFechaVencimiento('2026-06-04T00:00:00.000Z', NaN)).toBe('2026-06-04')
  })

  it('trunca días fraccionarios', () => {
    expect(calcularFechaVencimiento('2026-06-04T00:00:00.000Z', 30.9)).toBe('2026-07-04')
  })
})

describe('buildEmitirFacturaPatch', () => {
  const ahora = '2026-06-04T12:00:00.000Z'

  it('emite una factura pendiente: estado emitida + timestamp + snapshot IVA', () => {
    const patch = buildEmitirFacturaPatch(
      { id: 'f1', factura_estado: 'pendiente', monto_calculado: 100 },
      0.12,
      30,
      ahora,
    )
    expect(patch.factura_estado).toBe('emitida')
    expect(patch.emitida_at).toBe(ahora)
    expect(patch.fecha_vencimiento).toBe('2026-07-04')
    expect(patch.iva_tasa).toBe(0.12)
    expect(patch.iva_monto).toBe(12)
    expect(patch.monto_con_iva).toBe(112)
    expect(patch.total_a_pagar).toBe(112)
  })

  it('incluye la mora ya calculada en el total (no la recalcula)', () => {
    const patch = buildEmitirFacturaPatch(
      { id: 'f1', factura_estado: 'pendiente', monto_calculado: 100, mora_monto: 10 },
      0.12,
      30,
      ahora,
    )
    // 100 + 12 IVA + 10 mora = 122.
    expect(patch.total_a_pagar).toBe(122)
  })

  it('tasa de IVA null usa el default GT (12%)', () => {
    const patch = buildEmitirFacturaPatch(
      { id: 'f1', factura_estado: 'pendiente', monto_calculado: 200 },
      null,
      30,
      ahora,
    )
    expect(patch.iva_monto).toBe(24)
    expect(patch.total_a_pagar).toBe(224)
  })

  it('tasa de IVA 0 (exento) es válida y NO cae al default', () => {
    const patch = buildEmitirFacturaPatch(
      { id: 'f1', factura_estado: 'pendiente', monto_calculado: 100 },
      0,
      30,
      ahora,
    )
    expect(patch.iva_monto).toBe(0)
    expect(patch.total_a_pagar).toBe(100)
  })

  it('respeta dias_vencimiento de la regla para la fecha de vencimiento', () => {
    const patch = buildEmitirFacturaPatch(
      { id: 'f1', factura_estado: 'pendiente', monto_calculado: 100 },
      0.12,
      15,
      ahora,
    )
    expect(patch.fecha_vencimiento).toBe('2026-06-19')
  })

  it('lanza si la factura no se puede emitir (ya emitida/terminal)', () => {
    expect(() =>
      buildEmitirFacturaPatch({ id: 'f1', factura_estado: 'emitida', monto_calculado: 100 }, 0.12, 30, ahora),
    ).toThrow()
    expect(() =>
      buildEmitirFacturaPatch({ id: 'f1', factura_estado: 'pagada', monto_calculado: 100 }, 0.12, 30, ahora),
    ).toThrow()
  })

  it('subtotal ausente/no numérico se trata como 0', () => {
    const patch = buildEmitirFacturaPatch(
      { id: 'f1', factura_estado: 'pendiente', monto_calculado: null },
      0.12,
      30,
      ahora,
    )
    expect(patch.total_a_pagar).toBe(0)
  })
})

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
