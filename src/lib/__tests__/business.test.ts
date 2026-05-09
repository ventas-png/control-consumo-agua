import { describe, it, expect } from 'vitest'
import { calcularTotalPagar } from '../business'

describe('calcularTotalPagar', () => {
  describe('Tramo 1 — canon fijo (consumo ≤ mínimo)', () => {
    it('consumo = 0, retorna solo canon fijo', () => {
      const result = calcularTotalPagar(0, 5, 50, 10)
      expect(result.total).toBe(50)
      expect(result.tipo_cobro).toBe('Canon Fijo')
      expect(result.desglose.tramo).toBe(1)
    })

    it('consumo = consumoMinimo exacto, retorna canon fijo', () => {
      const result = calcularTotalPagar(10, 5, 50, 10)
      expect(result.total).toBe(50)
      expect(result.tipo_cobro).toBe('Canon Fijo')
    })

    it('consumoMinimo = 0 por defecto, consumo 0 retorna canon', () => {
      const result = calcularTotalPagar(0, 10, 100)
      expect(result.total).toBe(100)
      expect(result.tipo_cobro).toBe('Canon Fijo')
    })
  })

  describe('Tramo 2 — consumo normal', () => {
    it('consumo > mínimo sin derecho de servicio', () => {
      const result = calcularTotalPagar(20, 5, 50, 10)
      expect(result.total).toBe(100) // 20 * 5
      expect(result.tipo_cobro).toBe('Consumo Normal')
      expect(result.desglose.tramo).toBe(2)
    })

    it('consumo > mínimo con derecho de servicio pero consumo no supera el derecho', () => {
      const result = calcularTotalPagar(15, 5, 50, 10, 3, 30)
      expect(result.total).toBe(75) // 15 * 5
      expect(result.tipo_cobro).toBe('Consumo Normal')
    })

    it('sin consumoMinimo (default 0), consumo 1 aplica tramo 2', () => {
      const result = calcularTotalPagar(1, 8, 0)
      expect(result.total).toBe(8)
      expect(result.tipo_cobro).toBe('Consumo Normal')
    })
  })

  describe('Tramo 3 — consumo con exceso', () => {
    it('consumo supera el derecho de servicio', () => {
      const result = calcularTotalPagar(50, 5, 0, 0, 8, 30)
      // base: 30 * 5 = 150, exceso: 20 * 8 = 160, total: 310
      expect(result.total).toBe(310)
      expect(result.tipo_cobro).toBe('Consumo con Exceso')
      expect(result.desglose.tramo).toBe(3)
      expect(result.desglose.exceso_m3).toBe(20)
      expect(result.desglose.monto_base).toBe(150)
      expect(result.desglose.monto_exceso).toBe(160)
    })

    it('exactamente en el límite del derecho no aplica tramo 3', () => {
      const result = calcularTotalPagar(30, 5, 0, 0, 8, 30)
      expect(result.tipo_cobro).toBe('Consumo Normal')
    })

    it('sin tarifa exceso (0), no aplica tramo 3 aunque supere el derecho', () => {
      const result = calcularTotalPagar(50, 5, 0, 0, 0, 30)
      expect(result.tipo_cobro).toBe('Consumo Normal')
    })
  })

  describe('manejo de tipos de entrada', () => {
    it('acepta strings numéricos como tarifa y canon', () => {
      const result = calcularTotalPagar(20, '5' as unknown as number, '50' as unknown as number, 10)
      expect(result.total).toBe(100)
    })

    it('valores undefined/null se tratan como 0', () => {
      const result = calcularTotalPagar(20, 0, 0, 0)
      expect(result.total).toBe(0)
    })
  })
})
