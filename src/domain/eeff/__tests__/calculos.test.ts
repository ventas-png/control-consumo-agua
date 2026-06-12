import { describe, it, expect } from 'vitest'
import { resumirBalance, resumirPyG, rangoAnterior, compararPyG, resumirConsolidado } from '../calculos'
import type { ConsolidadoFila } from '../../../types/eeff'
import type { BalanceFila, EstadoResultadosFila } from '../../../types/eeff'

const pyg: EstadoResultadosFila[] = [
  { cuenta_id: 'a', codigo: '4101', nombre: 'Cuotas', tipo: 'ingreso', monto: 1000 },
  { cuenta_id: 'b', codigo: '4103', nombre: 'Mora', tipo: 'ingreso', monto: 50.5 },
  { cuenta_id: 'c', codigo: '5101', nombre: 'Mantenimiento', tipo: 'gasto', monto: 600.25 },
]

describe('resumirPyG', () => {
  it('separa ingresos/gastos y calcula el resultado neto', () => {
    const r = resumirPyG(pyg)
    expect(r.ingresos).toHaveLength(2)
    expect(r.gastos).toHaveLength(1)
    expect(r.totalIngresos).toBe(1050.5)
    expect(r.totalGastos).toBe(600.25)
    expect(r.resultado).toBe(450.25)
  })

  it('pérdida → resultado negativo', () => {
    const r = resumirPyG([
      { cuenta_id: 'a', codigo: '4101', nombre: 'Cuotas', tipo: 'ingreso', monto: 100 },
      { cuenta_id: 'c', codigo: '5101', nombre: 'Gasto', tipo: 'gasto', monto: 180 },
    ])
    expect(r.resultado).toBe(-80)
  })
})

describe('resumirBalance', () => {
  const balance: BalanceFila[] = [
    { cuenta_id: 'a', codigo: '1101', nombre: 'Caja', tipo: 'activo', saldo: 500 },
    { cuenta_id: 'b', codigo: '2101', nombre: 'IVA por pagar', tipo: 'pasivo', saldo: 60 },
    { cuenta_id: 'c', codigo: '3101', nombre: 'Resultados acumulados', tipo: 'capital', saldo: 240 },
    { cuenta_id: null, codigo: 'RESULTADO', nombre: 'Resultado del periodo', tipo: 'capital', saldo: 200 },
  ]

  it('agrupa por tipo con la fila sintética en capital', () => {
    const r = resumirBalance(balance)
    expect(r.totalActivo).toBe(500)
    expect(r.totalPasivo).toBe(60)
    expect(r.totalCapital).toBe(440)
    expect(r.descuadre).toBe(0)
  })

  it('detecta descuadre cuando A ≠ P + C', () => {
    const r = resumirBalance(balance.slice(0, 3))
    expect(r.descuadre).toBe(200)
  })
})

describe('rangoAnterior', () => {
  it('rango multi-mes: el bloque inmediato anterior de la misma longitud', () => {
    expect(rangoAnterior('2026-01', '2026-03')).toEqual({ desde: '2025-10', hasta: '2025-12' })
    expect(rangoAnterior('2026-01', '2026-12')).toEqual({ desde: '2025-01', hasta: '2025-12' })
  })

  it('un solo mes: el mes anterior (con cruce de año)', () => {
    expect(rangoAnterior('2026-05', '2026-05')).toEqual({ desde: '2026-04', hasta: '2026-04' })
    expect(rangoAnterior('2026-01', '2026-01')).toEqual({ desde: '2025-12', hasta: '2025-12' })
  })
})

describe('compararPyG', () => {
  const fila = (cuenta_id: string, codigo: string, tipo: 'ingreso' | 'gasto', monto: number) =>
    ({ cuenta_id, codigo, nombre: codigo, tipo, monto })

  it('fusiona por cuenta con variación absoluta y %', () => {
    const r = compararPyG(
      [fila('a', '4101', 'ingreso', 1200), fila('b', '5101', 'gasto', 300)],
      [fila('a', '4101', 'ingreso', 1000), fila('b', '5101', 'gasto', 400)],
    )
    expect(r.ingresos[0]).toMatchObject({ monto: 1200, montoAnterior: 1000, variacion: 200, variacionPct: 20 })
    expect(r.gastos[0]).toMatchObject({ monto: 300, montoAnterior: 400, variacion: -100, variacionPct: -25 })
    expect(r.totalIngresos).toBe(1200)
    expect(r.totalIngresosAnterior).toBe(1000)
    expect(r.resultado).toBe(900)
    expect(r.resultadoAnterior).toBe(600)
  })

  it('full outer: cuentas solo en uno de los dos periodos aparecen', () => {
    const r = compararPyG(
      [fila('nueva', '4102', 'ingreso', 50)],
      [fila('vieja', '4103', 'ingreso', 80)],
    )
    expect(r.ingresos.map((f) => f.codigo)).toEqual(['4102', '4103'])
    expect(r.ingresos[0]).toMatchObject({ monto: 50, montoAnterior: 0, variacionPct: null })
    expect(r.ingresos[1]).toMatchObject({ monto: 0, montoAnterior: 80, variacion: -80, variacionPct: -100 })
  })
})

describe('resumirConsolidado', () => {
  const fila = (nombre: string, tasa: number | null, conv: number | null): ConsolidadoFila => ({
    ledger_project_id: nombre === 'Empresa' ? null : nombre,
    ledger_nombre: nombre, moneda: tasa === 1 ? 'GTQ' : 'USD', tasa,
    ingresos_origen: 100, gastos_origen: 40, resultado_origen: 60,
    activo_origen: 500, pasivo_origen: 200, capital_origen: 300,
    ingresos: conv, gastos: conv === null ? null : conv * 0.4,
    resultado: conv === null ? null : conv * 0.6,
    activo: conv === null ? null : conv * 5, pasivo: conv === null ? null : conv * 2,
    capital: conv === null ? null : conv * 3,
  })

  it('suma solo las entidades convertidas y separa las sin tasa', () => {
    const r = resumirConsolidado([fila('Empresa', 1, 100), fila('P1', 7.95, 795), fila('P2', null, null)])
    expect(r.convertidas.map((f) => f.ledger_nombre)).toEqual(['Empresa', 'P1'])
    expect(r.sinTasa.map((f) => f.ledger_nombre)).toEqual(['P2'])
    expect(r.totalIngresos).toBe(895)
    expect(r.totalGastos).toBe(358)
    expect(r.totalResultado).toBe(537)
    expect(r.totalActivo).toBe(4475)
    expect(r.totalPasivo).toBe(1790)
    expect(r.totalCapital).toBe(2685)
    // Identidad contable del total: A = P + C
    expect(r.totalActivo).toBe(r.totalPasivo + r.totalCapital)
  })

  it('vacío y todo-sin-tasa producen totales en cero', () => {
    expect(resumirConsolidado([]).totalActivo).toBe(0)
    const r = resumirConsolidado([fila('P2', null, null)])
    expect(r.totalIngresos).toBe(0)
    expect(r.sinTasa).toHaveLength(1)
  })
})
