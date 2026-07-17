// F8 — Tests del costo puro del timbre fiscal.
import { describe, it, expect } from 'vitest'
import { calcularCostoTimbre, type TimbradoConfigRow } from '../costoTimbre.ts'

function cfg(over: Partial<TimbradoConfigRow> = {}): TimbradoConfigRow {
  return { activo: true, precio_dte_cents: 50, timbres_incluidos: 0, ...over }
}

describe('calcularCostoTimbre', () => {
  it('sin config o inactiva no hay modelo de cobro (null)', () => {
    expect(calcularCostoTimbre(null, 0)).toBeNull()
    expect(calcularCostoTimbre(undefined, 3)).toBeNull()
    expect(calcularCostoTimbre(cfg({ activo: false }), 0)).toBeNull()
  })

  it('dentro de la cuota incluida el timbre sale a 0', () => {
    const c = cfg({ timbres_incluidos: 10 })
    expect(calcularCostoTimbre(c, 0)).toBe(0)
    expect(calcularCostoTimbre(c, 9)).toBe(0)
  })

  it('agotada la cuota se cobra el precio vigente', () => {
    const c = cfg({ timbres_incluidos: 10, precio_dte_cents: 75 })
    expect(calcularCostoTimbre(c, 10)).toBe(75)
    expect(calcularCostoTimbre(c, 500)).toBe(75)
  })

  it('sin cuota incluida todo timbre cuesta', () => {
    expect(calcularCostoTimbre(cfg({ precio_dte_cents: 40 }), 0)).toBe(40)
  })

  it('config activa con precio 0 sella costo 0 (incluido ilimitado explícito)', () => {
    expect(calcularCostoTimbre(cfg({ precio_dte_cents: 0 }), 99)).toBe(0)
  })

  it('conteos inválidos se tratan como 0 previos', () => {
    const c = cfg({ timbres_incluidos: 1, precio_dte_cents: 30 })
    expect(calcularCostoTimbre(c, NaN)).toBe(0)
    expect(calcularCostoTimbre(c, -5)).toBe(0)
  })
})
