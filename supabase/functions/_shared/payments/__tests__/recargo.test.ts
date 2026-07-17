// Tests del cálculo puro del recargo por pago con tarjeta al cliente final.
import { describe, it, expect } from 'vitest'
import { calcularRecargo, totalConRecargo, type RecargoConfigRow } from '../recargo.ts'

function fila(over: Partial<RecargoConfigRow> = {}): RecargoConfigRow {
  return { canal: 'default', activo: true, pct: 0.05, fijo: 0, ...over }
}

describe('calcularRecargo', () => {
  it('sin filas no hay recargo', () => {
    expect(calcularRecargo(100, 'qpaypro', [])).toEqual({ recargo: null, detalle: null })
    expect(calcularRecargo(100, 'qpaypro', null)).toEqual({ recargo: null, detalle: null })
  })

  it('la fila del canal gana sobre la default y sella el detalle', () => {
    const rows = [fila({ canal: 'default', pct: 0.05 }), fila({ canal: 'qpaypro', pct: 0.06, fijo: 2 })]
    const r = calcularRecargo(100, 'qpaypro', rows)
    expect(r.recargo).toBe(8)
    expect(r.detalle).toEqual({ canal: 'qpaypro', pct: 0.06, fijo: 2 })
  })

  it('fila inactiva o en cero no genera recargo', () => {
    expect(calcularRecargo(100, 'stripe', [fila({ activo: false })])).toEqual({ recargo: null, detalle: null })
    expect(calcularRecargo(100, 'stripe', [fila({ pct: 0, fijo: 0 })])).toEqual({ recargo: null, detalle: null })
  })
})

describe('totalConRecargo', () => {
  it('suma a 2 decimales y tolera null', () => {
    expect(totalConRecargo(100, 8)).toBe(108)
    expect(totalConRecargo(100, null)).toBe(100)
    // Ambos operandos llegan ya redondeados a 2 decimales (calcularRecargo
    // redondea): la suma no debe introducir colas binarias (0.1+0.2 style).
    expect(totalConRecargo(33.33, 1.67)).toBe(35)
    expect(totalConRecargo(10.1, 0.2)).toBe(10.3)
  })
})
