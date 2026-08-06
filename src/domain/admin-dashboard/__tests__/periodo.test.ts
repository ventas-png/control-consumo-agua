// Contrato de los helpers de período del dashboard admin: detección de ventana
// vacía y rango que cubre el ciclo de lecturas más reciente (fix del dashboard
// en 0 con histórico cargado meses atrás).
import { describe, it, expect } from 'vitest'
import { contarRegistrosEnPeriodo, periodoUltimaLectura, ultimaFechaLectura } from '../periodo'

const reg = (fecha: string) => ({ fecha })

describe('contarRegistrosEnPeriodo', () => {
  it('cuenta solo los registros dentro del rango (límites inclusivos)', () => {
    const registros = [reg('2026-04-24'), reg('2026-04-25'), reg('2026-05-10'), reg('2026-05-11')]
    expect(contarRegistrosEnPeriodo(registros, '2026-04-25', '2026-05-10')).toBe(2)
  })

  it('acepta fechas con timestamp ISO (compara el prefijo YYYY-MM-DD)', () => {
    const registros = [reg('2026-05-25T18:00:00+00:00'), reg('2026-04-25T18:00:00+00:00')]
    expect(contarRegistrosEnPeriodo(registros, '2026-05-13', '2026-06-12')).toBe(1)
  })

  it('sin desde/hasta cuenta todo', () => {
    const registros = [reg('2025-01-25'), reg('2026-04-25')]
    expect(contarRegistrosEnPeriodo(registros)).toBe(2)
    expect(contarRegistrosEnPeriodo(registros, undefined, '2026-01-01')).toBe(1)
    expect(contarRegistrosEnPeriodo(registros, '2026-01-01', undefined)).toBe(1)
  })

  it('lista vacía → 0', () => {
    expect(contarRegistrosEnPeriodo([], '2026-01-01', '2026-12-31')).toBe(0)
  })
})

describe('ultimaFechaLectura', () => {
  it('devuelve la fecha más reciente normalizada a YYYY-MM-DD', () => {
    const registros = [reg('2026-04-25T18:00:00+00:00'), reg('2025-06-25'), reg('2026-01-25')]
    expect(ultimaFechaLectura(registros)).toBe('2026-04-25')
  })

  it('sin registros → null', () => {
    expect(ultimaFechaLectura([])).toBeNull()
  })
})

describe('periodoUltimaLectura', () => {
  const hoy = new Date('2026-06-12T12:00:00Z')

  it('cubre desde 30 días antes de la última lectura hasta hoy', () => {
    // Escenario Cascadas: histórico mensual que termina el 2026-04-25 con la
    // ventana por defecto (últimos 30 días) vacía.
    const registros = [reg('2025-01-25T18:00:00+00:00'), reg('2026-04-25T18:00:00+00:00')]
    expect(periodoUltimaLectura(registros, hoy)).toEqual({ desde: '2026-03-26', hasta: '2026-06-12' })
  })

  it('la última lectura siempre queda dentro del rango devuelto', () => {
    const registros = [reg('2026-04-25')]
    const rango = periodoUltimaLectura(registros, hoy)!
    expect(contarRegistrosEnPeriodo(registros, rango.desde, rango.hasta)).toBe(1)
  })

  it('extiende hasta la última lectura si es posterior a hoy', () => {
    const registros = [reg('2026-07-01')]
    expect(periodoUltimaLectura(registros, hoy)).toEqual({ desde: '2026-06-01', hasta: '2026-07-01' })
  })

  it('cruza límites de mes y de año al restar los 30 días', () => {
    expect(periodoUltimaLectura([reg('2026-01-15')], hoy)).toEqual({ desde: '2025-12-16', hasta: '2026-06-12' })
  })

  it('sin registros → null', () => {
    expect(periodoUltimaLectura([], hoy)).toBeNull()
  })

  it('fecha no parseable → null', () => {
    expect(periodoUltimaLectura([reg('sin-fecha')], hoy)).toBeNull()
  })
})
