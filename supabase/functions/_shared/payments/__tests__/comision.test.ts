// F7 — Tests del cálculo puro de la comisión transaccional de plataforma.
import { describe, it, expect } from 'vitest'
import { calcularComision, type ComisionConfigRow } from '../comision.ts'

function fila(over: Partial<ComisionConfigRow> = {}): ComisionConfigRow {
  return { canal: 'default', activo: true, pct: 0.025, fijo: 0, ...over }
}

describe('calcularComision', () => {
  it('sin filas no hay comisión', () => {
    expect(calcularComision(100, 'qpaypro', [])).toEqual({ comision: null, detalle: null })
    expect(calcularComision(100, 'qpaypro', null)).toEqual({ comision: null, detalle: null })
  })

  it('la fila del canal gana sobre la default', () => {
    const rows = [fila({ canal: 'default', pct: 0.05 }), fila({ canal: 'qpaypro', pct: 0.02 })]
    const r = calcularComision(1000, 'qpaypro', rows)
    expect(r.comision).toBe(20)
    expect(r.detalle).toEqual({ canal: 'qpaypro', pct: 0.02, fijo: 0 })
  })

  it('sin fila del canal cae a la default', () => {
    const rows = [fila({ canal: 'default', pct: 0.05 })]
    const r = calcularComision(200, 'stripe', rows)
    expect(r.comision).toBe(10)
    expect(r.detalle?.canal).toBe('default')
  })

  it('filas inactivas se ignoran (aunque sean del canal)', () => {
    const rows = [fila({ canal: 'stripe', activo: false, pct: 0.1 }), fila({ canal: 'default', pct: 0.01 })]
    expect(calcularComision(100, 'stripe', rows).comision).toBe(1)
    expect(calcularComision(100, 'stripe', [fila({ activo: false })]).comision).toBeNull()
  })

  it('mixto: pct + fijo, redondeado a 2 decimales', () => {
    const rows = [fila({ pct: 0.02, fijo: 1 })]
    // 150.5 * 0.02 = 3.01 → + 1 = 4.01
    expect(calcularComision(150.5, 'qpaypro', rows).comision).toBe(4.01)
    // 33.33 * 0.015 = 0.49995 → 0.5 → + 0.25 = 0.75
    expect(calcularComision(33.33, 'qpaypro', [fila({ pct: 0.015, fijo: 0.25 })]).comision).toBe(0.75)
  })

  it('config en cero (pct=0 y fijo=0) equivale a sin comisión', () => {
    expect(calcularComision(100, 'qpaypro', [fila({ pct: 0, fijo: 0 })]).comision).toBeNull()
  })

  it('la comisión nunca supera el monto del pago', () => {
    const rows = [fila({ pct: 0.05, fijo: 10 })]
    expect(calcularComision(2, 'qpaypro', rows).comision).toBe(2)
  })

  it('montos inválidos o no positivos no generan comisión', () => {
    const rows = [fila()]
    expect(calcularComision(0, 'qpaypro', rows).comision).toBeNull()
    expect(calcularComision(-5, 'qpaypro', rows).comision).toBeNull()
    expect(calcularComision(NaN, 'qpaypro', rows).comision).toBeNull()
  })

  it('pct/fijo no numéricos se tratan como 0', () => {
    const rows = [fila({ pct: NaN as unknown as number, fijo: 3 })]
    expect(calcularComision(100, 'qpaypro', rows).comision).toBe(3)
  })
})
