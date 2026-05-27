import { describe, it, expect } from 'vitest'
import { calcularTotalPagar, validarLectura } from '../business'

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

describe('validarLectura', () => {
  it('lectura actual mayor que anterior: válida, consumo positivo', () => {
    const r = validarLectura(100, 150)
    expect(r.valid).toBe(true)
    expect(r.consumo).toBe(50)
    expect(r.error).toBeUndefined()
    expect(r.warning).toBeUndefined()
  })

  it('lectura actual igual a la anterior: válida, consumo cero (medidor sin uso)', () => {
    const r = validarLectura(100, 100)
    expect(r.valid).toBe(true)
    expect(r.consumo).toBe(0)
  })

  it('lectura actual menor sin resetContador: inválida', () => {
    const r = validarLectura(100, 80)
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/menor que la anterior/)
  })

  it('lectura actual menor con resetContador: válida con warning', () => {
    const r = validarLectura(100, 5, { resetContador: true })
    expect(r.valid).toBe(true)
    expect(r.consumo).toBe(0)
    expect(r.warning).toMatch(/reset/i)
  })

  it('lectura negativa: inválida', () => {
    const r = validarLectura(100, -10)
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/no puede ser negativa/)
  })

  it('lectura anterior negativa: inválida', () => {
    const r = validarLectura(-5, 10)
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/anterior no puede ser negativa/)
  })

  it('lectura no numérica: inválida', () => {
    const r = validarLectura(NaN, 100)
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/números válidos/)
  })

  it('null/undefined se trata como 0', () => {
    expect(validarLectura(null, 50).consumo).toBe(50)
    expect(validarLectura(undefined, 50).consumo).toBe(50)
  })

  it('consumo dentro del rango histórico: sin warning', () => {
    const r = validarLectura(100, 130, { promedioHistorico: 20 })
    expect(r.valid).toBe(true)
    expect(r.consumo).toBe(30)
    expect(r.warning).toBeUndefined()
  })

  it('consumo >3× promedio histórico: válida con warning de salto anómalo', () => {
    const r = validarLectura(100, 250, { promedioHistorico: 20 })
    expect(r.valid).toBe(true)
    expect(r.consumo).toBe(150)
    expect(r.warning).toMatch(/promedio histórico/)
  })

  it('factor anormal custom respetado', () => {
    // Con factor=10, 100m³ vs promedio 20 NO debe alertar
    const r = validarLectura(100, 200, { promedioHistorico: 20, factorAnormal: 10 })
    expect(r.valid).toBe(true)
    expect(r.warning).toBeUndefined()
  })
})
