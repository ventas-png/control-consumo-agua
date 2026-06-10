import { describe, it, expect } from 'vitest'
import { balanzaConRollups, buildArbolCuentas, flattenArbol } from '../arbol'
import type { BalanzaFila, CuentaContable } from '../../../types/contabilidad'

function cuenta(partial: Partial<CuentaContable> & Pick<CuentaContable, 'id' | 'codigo' | 'nombre'>): CuentaContable {
  return {
    company_id: 'c1',
    tipo: 'activo',
    naturaleza: 'deudora',
    padre_id: null,
    nivel: 1,
    es_detalle: false,
    activa: true,
    es_sistema: true,
    moneda: null,
    descripcion: null,
    created_at: '',
    updated_at: '',
    ...partial,
  }
}

const catalogo: CuentaContable[] = [
  cuenta({ id: 'a', codigo: '1', nombre: 'Activo' }),
  cuenta({ id: 'a1', codigo: '11', nombre: 'Circulante', padre_id: 'a', nivel: 2 }),
  cuenta({ id: 'caja', codigo: '1101', nombre: 'Caja', padre_id: 'a1', nivel: 3, es_detalle: true }),
  cuenta({ id: 'bancos', codigo: '1102', nombre: 'Bancos', padre_id: 'a1', nivel: 3 }),
  cuenta({ id: 'b1', codigo: '1102-01', nombre: 'Banco GTQ', padre_id: 'bancos', nivel: 4, es_detalle: true }),
  cuenta({ id: 'ing', codigo: '4', nombre: 'Ingresos', tipo: 'ingreso', naturaleza: 'acreedora' }),
]

describe('buildArbolCuentas', () => {
  it('arma la jerarquía por padre_id ordenada por código', () => {
    const arbol = buildArbolCuentas(catalogo)
    expect(arbol.map((n) => n.codigo)).toEqual(['1', '4'])
    expect(arbol[0].hijos[0].codigo).toBe('11')
    expect(arbol[0].hijos[0].hijos.map((n) => n.codigo)).toEqual(['1101', '1102'])
    expect(arbol[0].hijos[0].hijos[1].hijos[0].codigo).toBe('1102-01')
  })

  it('las huérfanas (padre fuera de la lista) suben como raíces, no desaparecen', () => {
    const arbol = buildArbolCuentas([
      cuenta({ id: 'x', codigo: '9901', nombre: 'Huérfana', padre_id: 'no-existe', nivel: 3 }),
    ])
    expect(arbol).toHaveLength(1)
    expect(arbol[0].codigo).toBe('9901')
  })

  it('flattenArbol preserva el orden jerárquico (padre antes que hijos)', () => {
    const plano = flattenArbol(buildArbolCuentas(catalogo))
    expect(plano.map((n) => n.codigo)).toEqual(['1', '11', '1101', '1102', '1102-01', '4'])
  })
})

describe('balanzaConRollups', () => {
  const filas: BalanzaFila[] = [
    {
      cuenta_id: 'caja', codigo: '1101', nombre: 'Caja', tipo: 'activo', naturaleza: 'deudora',
      moneda: null, saldo_inicial: 100, cargos: 50, abonos: 20, saldo_final: 130, saldo_final_origen: null,
    },
    {
      cuenta_id: 'b1', codigo: '1102-01', nombre: 'Banco GTQ', tipo: 'activo', naturaleza: 'deudora',
      moneda: null, saldo_inicial: 0, cargos: 200, abonos: 0, saldo_final: 200, saldo_final_origen: null,
    },
  ]

  it('hace rollup hacia las cuentas agrupadoras en orden jerárquico', () => {
    const out = balanzaConRollups(catalogo, filas)
    expect(out.map((f) => f.cuenta.codigo)).toEqual(['1', '11', '1101', '1102', '1102-01'])
    const raiz = out[0]
    expect(raiz.esRollup).toBe(true)
    expect(raiz.saldo_inicial).toBe(100)
    expect(raiz.cargos).toBe(250)
    expect(raiz.saldo_final).toBe(330)
    const bancos = out.find((f) => f.cuenta.codigo === '1102')!
    expect(bancos.saldo_final).toBe(200)
  })

  it('omite ramas sin ningún movimiento', () => {
    const out = balanzaConRollups(catalogo, filas)
    expect(out.find((f) => f.cuenta.codigo === '4')).toBeUndefined()
  })

  it('las cuentas de detalle con movimiento no son rollup', () => {
    const out = balanzaConRollups(catalogo, filas)
    expect(out.find((f) => f.cuenta.codigo === '1101')!.esRollup).toBe(false)
  })
})
