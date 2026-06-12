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

// ── Comparativo vs periodo anterior (pendiente Fase 5) ──────────────────────

/**
 * Rango inmediatamente anterior de la misma longitud en meses.
 * Ej.: (2026-01, 2026-03) → (2025-10, 2025-12); (2026-05, 2026-05) → (2026-04, 2026-04).
 */
export function rangoAnterior(desde: string, hasta: string): { desde: string; hasta: string } {
  const aMeses = (p: string) => {
    const [y, m] = p.split('-').map(Number)
    return y * 12 + (m - 1)
  }
  const aPeriodo = (n: number) => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`
  const ini = aMeses(desde)
  const fin = aMeses(hasta)
  const len = Math.max(1, fin - ini + 1)
  return { desde: aPeriodo(ini - len), hasta: aPeriodo(ini - 1) }
}

export interface PyGComparadaFila extends EstadoResultadosFila {
  montoAnterior: number
  variacion: number
  /** % de variación vs anterior; null cuando el anterior es 0 (no comparable). */
  variacionPct: number | null
}

export interface ResumenPyGComparado extends ResumenPyG {
  ingresos: PyGComparadaFila[]
  gastos: PyGComparadaFila[]
  totalIngresosAnterior: number
  totalGastosAnterior: number
  resultadoAnterior: number
}

/**
 * Fusiona el P&L actual con el del periodo anterior por cuenta (full outer:
 * cuentas con movimiento solo en uno de los dos periodos también aparecen).
 */
export function compararPyG(
  actual: EstadoResultadosFila[],
  anterior: EstadoResultadosFila[],
): ResumenPyGComparado {
  const prevPorCuenta = new Map(anterior.map((f) => [f.cuenta_id, f]))
  const soloAnteriores = anterior
    .filter((f) => !actual.some((a) => a.cuenta_id === f.cuenta_id))
    .map((f) => ({ ...f, monto: 0, __prev: f.monto }))
  const filas: PyGComparadaFila[] = [
    ...actual.map((f) => ({ f, prev: prevPorCuenta.get(f.cuenta_id)?.monto ?? 0 })),
    ...soloAnteriores.map((f) => ({ f, prev: f.__prev })),
  ].map(({ f, prev }) => ({
    cuenta_id: f.cuenta_id,
    codigo: f.codigo,
    nombre: f.nombre,
    tipo: f.tipo,
    monto: f.monto,
    montoAnterior: r2(prev),
    variacion: r2(f.monto - prev),
    variacionPct: prev === 0 ? null : r2(((f.monto - prev) / Math.abs(prev)) * 100),
  })).sort((a, b) => a.codigo.localeCompare(b.codigo))

  const base = resumirPyG(filas)
  const prevResumen = resumirPyG(anterior)
  return {
    ...base,
    ingresos: filas.filter((f) => f.tipo === 'ingreso'),
    gastos: filas.filter((f) => f.tipo === 'gasto'),
    totalIngresosAnterior: prevResumen.totalIngresos,
    totalGastosAnterior: prevResumen.totalGastos,
    resultadoAnterior: prevResumen.resultado,
  }
}

// ── Vista consolidada (reporte de solo lectura) ─────────────────────────────
import type { ConsolidadoFila } from '../../types/eeff'

export interface ResumenConsolidado {
  /** Filas convertidas (con tasa), en el orden recibido. */
  convertidas: ConsolidadoFila[]
  /** Ledgers excluidos del total por no tener tasa registrada. */
  sinTasa: ConsolidadoFila[]
  totalIngresos: number
  totalGastos: number
  totalResultado: number
  totalActivo: number
  totalPasivo: number
  totalCapital: number
}

/**
 * Totaliza el consolidado sumando SOLO las entidades convertidas a la moneda
 * de la empresa; las sin tasa se reportan aparte (la UI las advierte).
 */
export function resumirConsolidado(filas: ConsolidadoFila[]): ResumenConsolidado {
  const convertidas = filas.filter((f) => f.tasa !== null)
  const sinTasa = filas.filter((f) => f.tasa === null)
  const suma = (sel: (f: ConsolidadoFila) => number | null) =>
    r2(convertidas.reduce((s, f) => s + (sel(f) ?? 0), 0))
  return {
    convertidas,
    sinTasa,
    totalIngresos: suma((f) => f.ingresos),
    totalGastos: suma((f) => f.gastos),
    totalResultado: suma((f) => f.resultado),
    totalActivo: suma((f) => f.activo),
    totalPasivo: suma((f) => f.pasivo),
    totalCapital: suma((f) => f.capital),
  }
}
