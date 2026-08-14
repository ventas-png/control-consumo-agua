import { describe, it, expect } from 'vitest'
import { diaISOSemana, fechaISO, gridMes, moverMes, rangoMes } from '../calendario'

describe('gridMes — celdas de la grilla mensual', () => {
  it('rellena hasta semanas completas', () => {
    const celdas = gridMes(2026, 8) // septiembre 2026
    expect(celdas.length % 7).toBe(0)
    expect(celdas.filter(c => c !== null)).toHaveLength(30)
  })

  it('la semana empieza en lunes, no en domingo', () => {
    // 2026-09-01 es martes ⇒ una sola celda de relleno antes del día 1.
    const celdas = gridMes(2026, 8)
    expect(celdas[0]).toBeNull()
    expect(celdas[1]).toBe(1)
  })

  it('un mes que arranca en lunes no lleva relleno inicial', () => {
    // 2026-06-01 es lunes.
    expect(gridMes(2026, 5)[0]).toBe(1)
  })

  it('febrero bisiesto trae 29 días', () => {
    expect(gridMes(2028, 1).filter(c => c !== null)).toHaveLength(29)
  })
})

describe('fechaISO / diaISOSemana', () => {
  it('arma la fecha con ceros a la izquierda', () => {
    expect(fechaISO(2026, 0, 5)).toBe('2026-01-05')
  })

  it('devuelve 1 para lunes y 7 para domingo', () => {
    expect(diaISOSemana('2026-09-07')).toBe(1)
    expect(diaISOSemana('2026-09-13')).toBe(7)
  })
})

describe('moverMes', () => {
  it('avanza al año siguiente', () => {
    expect(moverMes(2026, 11, 1)).toEqual({ year: 2027, month: 0 })
  })

  it('retrocede al año anterior', () => {
    expect(moverMes(2026, 0, -1)).toEqual({ year: 2025, month: 11 })
  })

  it('salta varios meses de una', () => {
    expect(moverMes(2026, 8, 6)).toEqual({ year: 2027, month: 2 })
  })
})

describe('rangoMes', () => {
  it('acota del primero al último día real', () => {
    expect(rangoMes(2026, 1)).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' })
    expect(rangoMes(2026, 8)).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' })
  })
})
