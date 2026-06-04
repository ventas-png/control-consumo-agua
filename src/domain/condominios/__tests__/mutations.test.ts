import { describe, it, expect, vi } from 'vitest'

// Stub del cliente Supabase: mutations.ts lo importa para los writes, pero esta
// suite solo ejercita los helpers PUROS (sin red). Evita el throw de env vars al
// cargar el módulo. Mismo patrón que facturacion/__tests__/mutations.test.ts.
vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => { throw new Error('default client should not be used in pure-logic tests') } },
}))

import {
  calcularFechaVencimientoCuota,
  buildEmitirCuotaPatch,
  TransicionCuotaInvalidaError,
} from '../mutations'
import { puedeTransicionarCuota } from '../../../lib/businessCondominios'

// Cubren la lógica PURA de las mutaciones de cuota (construcción del parche +
// gating de transición). La máquina de estados y el cálculo de mora/total ya están
// testeados en src/lib/__tests__/businessCondominios.test.ts; aquí verificamos que
// la orquestación los compone bien y respeta el gating ANTES del write.

describe('calcularFechaVencimientoCuota', () => {
  it('suma N días a la fecha base y devuelve YYYY-MM-DD', () => {
    expect(calcularFechaVencimientoCuota('2026-06-04T10:00:00.000Z', 30)).toBe('2026-07-04')
  })

  it('0 días devuelve el mismo día', () => {
    expect(calcularFechaVencimientoCuota('2026-06-04T10:00:00.000Z', 0)).toBe('2026-06-04')
  })

  it('cruza fin de mes correctamente', () => {
    expect(calcularFechaVencimientoCuota('2026-01-20T00:00:00.000Z', 15)).toBe('2026-02-04')
  })

  it('días no finitos se tratan como 0', () => {
    expect(calcularFechaVencimientoCuota('2026-06-04T00:00:00.000Z', NaN)).toBe('2026-06-04')
  })

  it('trunca días fraccionarios', () => {
    expect(calcularFechaVencimientoCuota('2026-06-04T00:00:00.000Z', 30.9)).toBe('2026-07-04')
  })
})

describe('buildEmitirCuotaPatch', () => {
  const ahora = '2026-06-04T12:00:00.000Z'

  it('emite una cuota pendiente: estado emitida + timestamp + fecha venc + total', () => {
    const patch = buildEmitirCuotaPatch(
      { id: 'c1', cuota_estado: 'pendiente', monto: 350 },
      30,
      ahora,
    )
    expect(patch.cuota_estado).toBe('emitida')
    expect(patch.emitida_at).toBe(ahora)
    expect(patch.fecha_vencimiento).toBe('2026-07-04')
    // SIN IVA: total = monto (+ mora). Sin mora → total = monto.
    expect(patch.total_a_pagar).toBe(350)
  })

  it('incluye la mora ya calculada en el total (no la recalcula) y NO añade IVA', () => {
    const patch = buildEmitirCuotaPatch(
      { id: 'c1', cuota_estado: 'pendiente', monto: 350, mora_monto: 17.5 },
      30,
      ahora,
    )
    // 350 + 17.5 mora = 367.5 (sin IVA).
    expect(patch.total_a_pagar).toBe(367.5)
  })

  it('respeta dias_vencimiento de la regla para la fecha de vencimiento', () => {
    const patch = buildEmitirCuotaPatch({ id: 'c1', cuota_estado: 'pendiente', monto: 100 }, 15, ahora)
    expect(patch.fecha_vencimiento).toBe('2026-06-19')
  })

  it('acepta el estado legacy de condominios (normaliza desde `estado`)', () => {
    // Una cuota legacy sin emitir tiene cuota_estado null; pasamos el legacy.
    const patch = buildEmitirCuotaPatch({ id: 'c1', cuota_estado: null, monto: 100 }, 30, ahora)
    expect(patch.cuota_estado).toBe('emitida')
  })

  it('monto ausente/no numérico se trata como 0', () => {
    const patch = buildEmitirCuotaPatch({ id: 'c1', cuota_estado: 'pendiente', monto: null }, 30, ahora)
    expect(patch.total_a_pagar).toBe(0)
  })

  it('lanza si la cuota no se puede emitir (ya emitida/terminal/legacy pagado)', () => {
    expect(() => buildEmitirCuotaPatch({ id: 'c1', cuota_estado: 'emitida', monto: 100 }, 30, ahora)).toThrow()
    expect(() => buildEmitirCuotaPatch({ id: 'c1', cuota_estado: 'pagada', monto: 100 }, 30, ahora)).toThrow()
    // 'pagado' legacy → 'pagada' (terminal) → no emitible.
    expect(() => buildEmitirCuotaPatch({ id: 'c1', cuota_estado: 'pagado', monto: 100 }, 30, ahora)).toThrow()
  })
})

describe('gating de transición de cuota (fuente de verdad businessCondominios)', () => {
  it('pendiente: solo emitir/anular', () => {
    expect(puedeTransicionarCuota('pendiente', 'emitir').ok).toBe(true)
    expect(puedeTransicionarCuota('pendiente', 'anular').ok).toBe(true)
    expect(puedeTransicionarCuota('pendiente', 'pagar').ok).toBe(false)
  })

  it('emitida: pagar/anular sí, emitir no', () => {
    expect(puedeTransicionarCuota('emitida', 'pagar').ok).toBe(true)
    expect(puedeTransicionarCuota('emitida', 'anular').ok).toBe(true)
    expect(puedeTransicionarCuota('emitida', 'emitir').ok).toBe(false)
  })

  it('legacy "moroso" (→ vencida): pagar/anular sí, emitir no', () => {
    expect(puedeTransicionarCuota('moroso', 'pagar').ok).toBe(true)
    expect(puedeTransicionarCuota('moroso', 'anular').ok).toBe(true)
    expect(puedeTransicionarCuota('moroso', 'emitir').ok).toBe(false)
  })

  it('estados terminales (pagada/anulada y legacy pagado): ninguna acción', () => {
    for (const estado of ['pagada', 'anulada', 'pagado'] as const) {
      expect(puedeTransicionarCuota(estado, 'emitir').ok).toBe(false)
      expect(puedeTransicionarCuota(estado, 'pagar').ok).toBe(false)
      expect(puedeTransicionarCuota(estado, 'anular').ok).toBe(false)
    }
  })
})

describe('TransicionCuotaInvalidaError', () => {
  it('conserva la acción y el estado actual para diagnóstico', () => {
    const err = new TransicionCuotaInvalidaError('pagada', 'emitir')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('TransicionCuotaInvalidaError')
    expect(err.accion).toBe('emitir')
    expect(err.estadoActual).toBe('pagada')
  })
})
