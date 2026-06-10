import { describe, it, expect } from 'vitest'
import { resumirBalance, resumirPyG } from '../calculos'
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
