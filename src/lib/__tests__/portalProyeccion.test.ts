import { describe, it, expect } from 'vitest'
import { proyectarProximoRecibo, type LecturaProyeccion } from '../portalProyeccion'

function lec(partial: Partial<LecturaProyeccion>): LecturaProyeccion {
  return {
    contador_id: 'c1', fecha: '2026-06-10', consumo: 10,
    tarifa_aplicada: 5, tarifa_exceso_aplicada: 0, canon_aplicado: 0,
    ...partial,
  }
}

describe('proyectarProximoRecibo', () => {
  it('sin lecturas: base sin_datos y ceros', () => {
    const p = proyectarProximoRecibo([])
    expect(p.base).toBe('sin_datos')
    expect(p.consumoProyectado).toBe(0)
    expect(p.montoProyectado).toBe(0)
    expect(p.mesesUsados).toBe(0)
  })

  it('promedia los últimos meses y valora con la última tarifa del medidor', () => {
    const p = proyectarProximoRecibo([
      lec({ fecha: '2026-04-10', consumo: 10, tarifa_aplicada: 4 }),
      lec({ fecha: '2026-05-10', consumo: 20, tarifa_aplicada: 4 }),
      lec({ fecha: '2026-06-10', consumo: 30, tarifa_aplicada: 5 }), // más reciente → tarifa 5
    ])
    // promedio de 3 meses = 20; costo = 20 * 5 (tarifa de la última lectura)
    expect(p.consumoProyectado).toBe(20)
    expect(p.montoProyectado).toBe(100)
    expect(p.base).toBe('promedio')
    expect(p.mesesUsados).toBe(3)
  })

  it('respeta la ventana de meses (solo promedia los N más recientes)', () => {
    const p = proyectarProximoRecibo([
      lec({ fecha: '2026-01-10', consumo: 100 }), // fuera de la ventana de 2
      lec({ fecha: '2026-05-10', consumo: 20 }),
      lec({ fecha: '2026-06-10', consumo: 40 }),
    ], { ventanaMeses: 2 })
    expect(p.consumoProyectado).toBe(30) // (20 + 40) / 2
    expect(p.mesesUsados).toBe(2)
  })

  it('suma la proyección de varios medidores', () => {
    const p = proyectarProximoRecibo([
      lec({ contador_id: 'c1', fecha: '2026-06-10', consumo: 10, tarifa_aplicada: 5 }),
      lec({ contador_id: 'c2', fecha: '2026-06-10', consumo: 8, tarifa_aplicada: 3 }),
    ])
    expect(p.consumoProyectado).toBe(18)
    expect(p.montoProyectado).toBe(74) // 10*5 + 8*3
  })

  it('agrega varias lecturas del mismo mes antes de promediar', () => {
    const p = proyectarProximoRecibo([
      lec({ fecha: '2026-06-05', consumo: 6 }),
      lec({ fecha: '2026-06-20', consumo: 4 }),
    ])
    // un solo mes con total 10 → proyección 10
    expect(p.consumoProyectado).toBe(10)
    expect(p.mesesUsados).toBe(1)
  })

  it('ignora lecturas sin contador_id', () => {
    const p = proyectarProximoRecibo([lec({ contador_id: null, consumo: 999 })])
    expect(p.base).toBe('sin_datos')
    expect(p.consumoProyectado).toBe(0)
  })

  it('tarifa desconocida (snapshot ausente) proyecta consumo pero monto 0', () => {
    const p = proyectarProximoRecibo([
      lec({ fecha: '2026-06-10', consumo: 15, tarifa_aplicada: null, canon_aplicado: null }),
    ])
    expect(p.consumoProyectado).toBe(15)
    expect(p.montoProyectado).toBe(0)
    expect(p.base).toBe('promedio')
  })
})
