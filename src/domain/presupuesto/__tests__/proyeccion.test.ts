import { describe, it, expect } from 'vitest'
import { proyeccionPresupuesto } from '../proyeccion'
import type { PresupuestoVsRealFila } from '../../../types/presupuesto'

function fila(periodo: string, presupuestado: number, ejecutado: number): PresupuestoVsRealFila {
  return { cuenta_id: 'c1', codigo: '5001', nombre: 'Gasto', naturaleza: 'deudora', periodo, presupuestado, ejecutado, variacion: ejecutado - presupuestado }
}

describe('proyeccionPresupuesto', () => {
  it('agrega presupuestado/ejecutado por mes y suma anual', () => {
    const filas = [fila('2026-01', 100, 90), fila('2026-02', 100, 110), fila('2026-03', 100, 0)]
    const r = proyeccionPresupuesto(filas, 2026, new Date(2026, 2, 15)) // 15 marzo 2026
    expect(r.presupuestadoAnual).toBe(300)
    expect(r.ejecutadoAcum).toBe(200)
    expect(r.presupuestadoMensual.slice(0, 3)).toEqual([100, 100, 100])
    expect(r.ejecutadoMensual.slice(0, 3)).toEqual([90, 110, 0])
  })

  it('proyecta con run-rate lineal de los meses transcurridos (año en curso)', () => {
    // 3 meses transcurridos, ejecutado 300 → run-rate 100/mes → proyección 1200.
    const filas = [fila('2026-01', 100, 100), fila('2026-02', 100, 100), fila('2026-03', 100, 100)]
    const r = proyeccionPresupuesto(filas, 2026, new Date(2026, 2, 20)) // marzo = mes 3
    expect(r.mesesTranscurridos).toBe(3)
    expect(r.proyeccionAnual).toBe(1200)
    expect(r.desviacionProyectada).toBe(1200 - 300)
  })

  it('año pasado: la proyección es el ejecutado real (12 meses)', () => {
    const filas = [fila('2025-01', 100, 80), fila('2025-06', 100, 120)]
    const r = proyeccionPresupuesto(filas, 2025, new Date(2026, 0, 10))
    expect(r.mesesTranscurridos).toBe(12)
    expect(r.proyeccionAnual).toBe(200) // = ejecutadoAcum, sin extrapolar
  })

  it('año futuro: sin ejecución, la proyección iguala el presupuesto', () => {
    const filas = [fila('2027-01', 100, 0), fila('2027-02', 100, 0)]
    const r = proyeccionPresupuesto(filas, 2027, new Date(2026, 5, 1))
    expect(r.mesesTranscurridos).toBe(0)
    expect(r.proyeccionAnual).toBe(200)
    expect(r.desviacionProyectada).toBe(0)
  })

  it('ignora periodos fuera del año', () => {
    const filas = [fila('2026-01', 100, 50), fila('2025-12', 999, 999)]
    const r = proyeccionPresupuesto(filas, 2026, new Date(2026, 0, 20))
    expect(r.presupuestadoAnual).toBe(100)
    expect(r.ejecutadoAcum).toBe(50)
  })
})
