import { describe, it, expect } from 'vitest'
import { planPagoCuota, round2, facturaTransicionaAPagada, residentePuedePagarCuota } from '../reconcile.ts'

describe('round2', () => {
  it('redondea a 2 decimales', () => {
    expect(round2(100.1 - 100.1)).toBe(0)
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(round2(33.335)).toBe(33.34)
  })
})

describe('planPagoCuota', () => {
  it('pago completo → liquida, pago_total, saldo 0', () => {
    expect(planPagoCuota(100, 0, 100)).toEqual({ saldoRestante: 0, liquida: true, tipoAplicacion: 'pago_total' })
  })

  it('abono parcial → no liquida, abono, saldo reducido', () => {
    expect(planPagoCuota(100, 0, 40)).toEqual({ saldoRestante: 60, liquida: false, tipoAplicacion: 'abono' })
  })

  it('segundo abono que liquida → pago_total', () => {
    expect(planPagoCuota(100, 40, 60)).toEqual({ saldoRestante: 0, liquida: true, tipoAplicacion: 'pago_total' })
  })

  it('abono intermedio con abonos previos → abono, saldo restante', () => {
    expect(planPagoCuota(100, 30, 20)).toEqual({ saldoRestante: 50, liquida: false, tipoAplicacion: 'abono' })
  })

  it('sobrepago se clampa a saldo 0 (nunca negativo)', () => {
    expect(planPagoCuota(100, 0, 150)).toEqual({ saldoRestante: 0, liquida: true, tipoAplicacion: 'pago_total' })
  })

  it('precisión de coma flotante: total con decimales liquida exacto', () => {
    expect(planPagoCuota(100.1, 0, 100.1)).toEqual({ saldoRestante: 0, liquida: true, tipoAplicacion: 'pago_total' })
  })

  it('cuota con mora: total_a_pagar mayor al monto base', () => {
    // total_a_pagar = 120 (100 + 20 mora); abono de 50 deja 70.
    expect(planPagoCuota(120, 0, 50)).toEqual({ saldoRestante: 70, liquida: false, tipoAplicacion: 'abono' })
  })
})

describe('facturaTransicionaAPagada', () => {
  it('emitida y vencida pagan', () => {
    expect(facturaTransicionaAPagada('emitida')).toBe(true)
    expect(facturaTransicionaAPagada('vencida')).toBe(true)
  })

  it('legacy: mora → vencida paga', () => {
    expect(facturaTransicionaAPagada('mora')).toBe(true)
  })

  it('sin factura / pendiente / null / undefined NO transiciona', () => {
    expect(facturaTransicionaAPagada(null)).toBe(false)
    expect(facturaTransicionaAPagada(undefined)).toBe(false)
    expect(facturaTransicionaAPagada('pendiente')).toBe(false)
  })

  it('estados terminales no re-transicionan', () => {
    expect(facturaTransicionaAPagada('pagada')).toBe(false)
    expect(facturaTransicionaAPagada('pagado')).toBe(false) // legacy → pagada
    expect(facturaTransicionaAPagada('anulada')).toBe(false)
  })
})

describe('residentePuedePagarCuota', () => {
  it('no-residente (rol null/undefined) nunca puede pagar', () => {
    expect(residentePuedePagarCuota(null, null)).toBe(false)
    expect(residentePuedePagarCuota('propietario', null)).toBe(false)
    expect(residentePuedePagarCuota('arrendatario', undefined)).toBe(false)
  })

  it('cuota sin diferenciar (null/vacío) → cualquier residente puede', () => {
    expect(residentePuedePagarCuota(null, 'propietario')).toBe(true)
    expect(residentePuedePagarCuota(null, 'arrendatario')).toBe(true)
    expect(residentePuedePagarCuota('', 'familiar')).toBe(true)
  })

  it('cuota diferenciada → solo el residente de ese rol', () => {
    expect(residentePuedePagarCuota('propietario', 'propietario')).toBe(true)
    expect(residentePuedePagarCuota('arrendatario', 'arrendatario')).toBe(true)
  })

  it('cuota diferenciada → el otro rol NO puede (regla "ocultar del otro")', () => {
    // Dueño no paga la del inquilino y viceversa.
    expect(residentePuedePagarCuota('arrendatario', 'propietario')).toBe(false)
    expect(residentePuedePagarCuota('propietario', 'arrendatario')).toBe(false)
  })
})
