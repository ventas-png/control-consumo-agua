// Estados financieros — agregaciones puras para la UI (testeables).
import type { BalanceFila, EstadoResultadosFila } from '../../types/eeff'

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export interface ResumenPyG {
  ingresos: EstadoResultadosFila[]
  gastos: EstadoResultadosFila[]
  totalIngresos: number
  totalGastos: number
  resultado: number
}

/** Agrupa el P&L en ingresos/gastos con totales y resultado neto. */
export function resumirPyG(filas: EstadoResultadosFila[]): ResumenPyG {
  const ingresos = filas.filter((f) => f.tipo === 'ingreso')
  const gastos = filas.filter((f) => f.tipo === 'gasto')
  const totalIngresos = r2(ingresos.reduce((s, f) => s + f.monto, 0))
  const totalGastos = r2(gastos.reduce((s, f) => s + f.monto, 0))
  return { ingresos, gastos, totalIngresos, totalGastos, resultado: r2(totalIngresos - totalGastos) }
}

export interface ResumenBalance {
  activo: BalanceFila[]
  pasivo: BalanceFila[]
  capital: BalanceFila[]
  totalActivo: number
  totalPasivo: number
  totalCapital: number
  /** Activo − (Pasivo + Capital): 0 = balance cuadrado. */
  descuadre: number
}

/** Agrupa el balance por tipo; la fila sintética RESULTADO va en capital. */
export function resumirBalance(filas: BalanceFila[]): ResumenBalance {
  const activo = filas.filter((f) => f.tipo === 'activo')
  const pasivo = filas.filter((f) => f.tipo === 'pasivo')
  const capital = filas.filter((f) => f.tipo === 'capital')
  const totalActivo = r2(activo.reduce((s, f) => s + f.saldo, 0))
  const totalPasivo = r2(pasivo.reduce((s, f) => s + f.saldo, 0))
  const totalCapital = r2(capital.reduce((s, f) => s + f.saldo, 0))
  return {
    activo, pasivo, capital, totalActivo, totalPasivo, totalCapital,
    descuadre: r2(totalActivo - totalPasivo - totalCapital),
  }
}
