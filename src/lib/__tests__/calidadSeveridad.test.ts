import { describe, it, expect } from 'vitest'
import { validarValorParametro, severidadParametro } from '../calidadSeveridad'

describe('validarValorParametro (serv:S20)', () => {
  it('vacío = válido (parámetro opcional)', () => {
    expect(validarValorParametro('').valido).toBe(true)
    expect(validarValorParametro('   ').valido).toBe(true)
  })
  it('rechaza no numéricos', () => {
    expect(validarValorParametro('abc').valido).toBe(false)
    expect(validarValorParametro('5,5').valido).toBe(false)
  })
  it('rechaza negativos (una medición de laboratorio no puede serlo)', () => {
    expect(validarValorParametro('-1').valido).toBe(false)
  })
  it('acepta enteros y decimales no negativos', () => {
    expect(validarValorParametro('0').valido).toBe(true)
    expect(validarValorParametro('7.25').valido).toBe(true)
  })
})

describe('severidadParametro (serv:S20 — % del rango)', () => {
  const pH = { min: 6.5, max: 8.5 }   // ancho 2
  const turbiedad = { min: 0, max: 5 } // ancho 5
  const microbio = { min: 0, max: 0 }

  it('vacío o inválido → null', () => {
    expect(severidadParametro(pH, '')).toBeNull()
    expect(severidadParametro(pH, 'abc')).toBeNull()
    expect(severidadParametro(pH, '-3')).toBeNull()
  })

  it('dentro de rango → ok', () => {
    expect(severidadParametro(pH, '7.0')).toBe('ok')
    expect(severidadParametro(turbiedad, '0')).toBe('ok')
    expect(severidadParametro(turbiedad, '5')).toBe('ok')
  })

  it('microbiológicos: 0 → ok, cualquier presencia → crítico', () => {
    expect(severidadParametro(microbio, '0')).toBe('ok')
    expect(severidadParametro(microbio, '1')).toBe('critico')
  })

  it('exceso ≤10% del ancho → leve', () => {
    expect(severidadParametro(turbiedad, '5.4')).toBe('leve')   // exceso 0.4 / 5 = 0.08
    expect(severidadParametro(pH, '8.6')).toBe('leve')          // exceso 0.1 / 2 = 0.05
  })

  it('exceso ≤50% del ancho → moderado', () => {
    expect(severidadParametro(turbiedad, '7.5')).toBe('moderado') // exceso 2.5 / 5 = 0.5
    expect(severidadParametro(pH, '6.0')).toBe('moderado')        // exceso 0.5 / 2 = 0.25 (por debajo del min)
  })

  it('exceso >50% del ancho → crítico', () => {
    expect(severidadParametro(turbiedad, '10')).toBe('critico')   // exceso 5 / 5 = 1.0
    expect(severidadParametro(pH, '9.9')).toBe('critico')         // exceso 1.4 / 2 = 0.7
  })
})
