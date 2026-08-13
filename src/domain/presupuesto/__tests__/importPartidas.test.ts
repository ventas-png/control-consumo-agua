import { describe, it, expect } from 'vitest'
import {
  COLUMNAS_MES,
  parseMontoPresupuesto,
  resolverPartidas,
  totalMeses,
  validarFilaPartida,
  type CuentaPresupuestable,
  type PartidaImportFila,
} from '../importPartidas'

/** Fila cruda con los meses que se indiquen (índice 0 = enero). */
function filaCruda(
  codigo: string,
  meses: Array<number | string> = [],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const row: Record<string, unknown> = { codigo_cuenta: codigo, ...extra }
  meses.forEach((m, i) => { row[COLUMNAS_MES[i]] = m })
  return row
}

function cuenta(over: Partial<CuentaPresupuestable> & { codigo: string; id: string }): CuentaPresupuestable {
  return {
    nombre: 'Cuenta',
    tipo: 'gasto',
    es_detalle: true,
    activa: true,
    ...over,
  }
}

describe('parseMontoPresupuesto', () => {
  it('acepta números, moneda y separadores de miles', () => {
    expect(parseMontoPresupuesto(4500)).toBe(4500)
    expect(parseMontoPresupuesto('1,234.56')).toBe(1234.56)
    expect(parseMontoPresupuesto('Q 1,234.56')).toBe(1234.56)
    expect(parseMontoPresupuesto('1.234,56')).toBe(1234.56)  // formato europeo
  })

  it('la celda vacía es 0, no un error', () => {
    expect(parseMontoPresupuesto('')).toBe(0)
    expect(parseMontoPresupuesto(null)).toBe(0)
    expect(parseMontoPresupuesto(undefined)).toBe(0)
  })

  it('rechaza negativos y basura (monto >= 0 en BD)', () => {
    expect(parseMontoPresupuesto(-100)).toBeNull()
    expect(parseMontoPresupuesto('(150.00)')).toBeNull()
    expect(parseMontoPresupuesto('mucho')).toBeNull()
  })
})

describe('validarFilaPartida', () => {
  it('toma los meses tal cual cuando vienen capturados', () => {
    const r = validarFilaPartida(filaCruda('5201', [1000, 2000, 3000]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.codigo_cuenta).toBe('5201')
    expect(r.data.meses.slice(0, 4)).toEqual([1000, 2000, 3000, 0])
    expect(totalMeses(r.data.meses)).toBe(6000)
  })

  it('reparte total_anual en 12 cuando no hay desglose mensual', () => {
    const r = validarFilaPartida(filaCruda('5201', [], { total_anual: 12000 }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.meses).toHaveLength(12)
    expect(new Set(r.data.meses)).toEqual(new Set([1000]))
    expect(totalMeses(r.data.meses)).toBe(12000)
  })

  it('el reparto cuadra al centavo aunque el anual no sea divisible', () => {
    const r = validarFilaPartida(filaCruda('5201', [], { total_anual: 10000 }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(totalMeses(r.data.meses)).toBe(10000)
    expect(r.data.meses[11]).not.toBe(r.data.meses[0])  // la última absorbe el residuo
  })

  it('acepta meses y total_anual cuando cuadran', () => {
    const r = validarFilaPartida(filaCruda('5201', [500, 500], { total_anual: 1000 }))
    expect(r.ok && r.data.meses.slice(0, 2)).toEqual([500, 500])
  })

  it('rechaza la fila cuando los meses y total_anual se contradicen', () => {
    const r = validarFilaPartida(filaCruda('5201', [500, 500], { total_anual: 9000 }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors[0]).toMatch(/suman 1000.*9000/)
  })

  it('rechaza la fila sin monto y la que no trae cuenta', () => {
    expect(validarFilaPartida(filaCruda('5201')).ok).toBe(false)
    expect(validarFilaPartida(filaCruda('', [100])).ok).toBe(false)
  })

  it('señala el mes exacto que no se pudo leer', () => {
    const r = validarFilaPartida(filaCruda('5201', [1000, 'dos mil']))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors[0]).toMatch(/^feb:/)
  })
})

describe('resolverPartidas', () => {
  const cuentas: CuentaPresupuestable[] = [
    cuenta({ id: 'c-gasto', codigo: '5201', nombre: 'Energía', tipo: 'gasto' }),
    cuenta({ id: 'c-ingreso', codigo: '4101', nombre: 'Cuotas', tipo: 'ingreso' }),
    cuenta({ id: 'c-banco', codigo: '1102', nombre: 'Bancos', tipo: 'activo' }),
    cuenta({ id: 'c-grupo', codigo: '52', nombre: 'Gastos', es_detalle: false }),
    cuenta({ id: 'c-baja', codigo: '5299', nombre: 'Obsoleta', activa: false }),
  ]

  function fila(codigo: string, meses: number[]): PartidaImportFila {
    const doce = Array(12).fill(0)
    meses.forEach((m, i) => { doce[i] = m })
    return { codigo_cuenta: codigo, meses: doce }
  }

  it('resuelve el código contra el catálogo del ledger', () => {
    const plan = resolverPartidas([fila('5201', [100])], cuentas)
    expect(plan.aplicar).toHaveLength(1)
    expect(plan.aplicar[0]).toMatchObject({ cuenta_id: 'c-gasto', codigo: '5201' })
    expect(plan.omitidas).toEqual([])
  })

  it('presupuesta ingresos y gastos, y descarta el resto del balance', () => {
    const plan = resolverPartidas([fila('4101', [100]), fila('1102', [100])], cuentas)
    expect(plan.aplicar.map((p) => p.codigo)).toEqual(['4101'])
    expect(plan.omitidas[0].motivo).toMatch(/ingreso y gasto/i)
  })

  it('descarta agrupadoras, inactivas y códigos inexistentes con su motivo', () => {
    const plan = resolverPartidas(
      [fila('52', [100]), fila('5299', [100]), fila('9999', [100])],
      cuentas,
    )
    expect(plan.aplicar).toEqual([])
    expect(plan.omitidas.map((o) => o.motivo)).toEqual([
      expect.stringMatching(/agrupadora/i),
      expect.stringMatching(/inactiva/i),
      expect.stringMatching(/no existe/i),
    ])
  })

  it('suma las filas repetidas de una misma cuenta (desglose por concepto)', () => {
    const plan = resolverPartidas([fila('5201', [100, 50]), fila('5201', [900, 25])], cuentas)
    expect(plan.aplicar).toHaveLength(1)
    expect(plan.aplicar[0].meses.slice(0, 2)).toEqual([1000, 75])
    expect(plan.sumadas).toEqual(['5201'])
  })

  it('ordena por código para que el editor quede legible', () => {
    const plan = resolverPartidas([fila('5201', [1]), fila('4101', [1])], cuentas)
    expect(plan.aplicar.map((p) => p.codigo)).toEqual(['4101', '5201'])
  })
})
