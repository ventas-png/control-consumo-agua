// Contabilidad — armado del árbol del catálogo de cuentas (puro, testeable).
import type { CuentaContable, BalanzaFila } from '../../types/contabilidad'

export interface CuentaNode extends CuentaContable {
  hijos: CuentaNode[]
}

/**
 * Construye el árbol de cuentas a partir de la lista plana (padre_id).
 * Las raíces y los hijos quedan ordenados por código. Cuentas huérfanas
 * (padre inexistente, p. ej. padre desactivado/filtrado) suben como raíces
 * para que nunca desaparezcan de la vista.
 */
export function buildArbolCuentas(cuentas: CuentaContable[]): CuentaNode[] {
  const porId = new Map<string, CuentaNode>()
  for (const c of cuentas) porId.set(c.id, { ...c, hijos: [] })

  const raices: CuentaNode[] = []
  for (const nodo of porId.values()) {
    const padre = nodo.padre_id ? porId.get(nodo.padre_id) : undefined
    if (padre) padre.hijos.push(nodo)
    else raices.push(nodo)
  }

  const porCodigo = (a: CuentaNode, b: CuentaNode) => a.codigo.localeCompare(b.codigo, 'es')
  const ordenar = (nodos: CuentaNode[]) => {
    nodos.sort(porCodigo)
    for (const n of nodos) ordenar(n.hijos)
  }
  ordenar(raices)
  return raices
}

/** Aplana el árbol en orden jerárquico (para tablas con indentación). */
export function flattenArbol(nodos: CuentaNode[]): CuentaNode[] {
  const out: CuentaNode[] = []
  const walk = (ns: CuentaNode[]) => {
    for (const n of ns) {
      out.push(n)
      walk(n.hijos)
    }
  }
  walk(nodos)
  return out
}

export interface BalanzaNodo {
  cuenta: CuentaContable
  saldo_inicial: number
  cargos: number
  abonos: number
  saldo_final: number
  saldo_final_origen: number | null
  /** true cuando el monto es rollup de descendientes (cuenta agrupadora). */
  esRollup: boolean
}

/**
 * Combina el catálogo con las filas de la balanza (solo cuentas de detalle con
 * movimiento) y hace rollup hacia las cuentas agrupadoras. Devuelve las filas
 * en orden jerárquico, omitiendo ramas sin ningún movimiento.
 */
export function balanzaConRollups(
  cuentas: CuentaContable[],
  filas: BalanzaFila[],
): BalanzaNodo[] {
  const porCuenta = new Map(filas.map((f) => [f.cuenta_id, f]))
  const arbol = buildArbolCuentas(cuentas)
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

  // Pasada 1: totales por nodo (propios + descendientes); null = rama sin movimiento.
  const totales = new Map<string, Omit<BalanzaNodo, 'cuenta'> | null>()
  const calcular = (nodo: CuentaNode): Omit<BalanzaNodo, 'cuenta'> | null => {
    const hijos = nodo.hijos
      .map(calcular)
      .filter((t): t is Omit<BalanzaNodo, 'cuenta'> => t !== null)
    const propia = porCuenta.get(nodo.id)
    const t = !propia && hijos.length === 0 ? null : {
      saldo_inicial: r2((propia?.saldo_inicial ?? 0) + hijos.reduce((s, h) => s + h.saldo_inicial, 0)),
      cargos: r2((propia?.cargos ?? 0) + hijos.reduce((s, h) => s + h.cargos, 0)),
      abonos: r2((propia?.abonos ?? 0) + hijos.reduce((s, h) => s + h.abonos, 0)),
      saldo_final: r2((propia?.saldo_final ?? 0) + hijos.reduce((s, h) => s + h.saldo_final, 0)),
      saldo_final_origen: propia?.saldo_final_origen ?? null,
      esRollup: !propia,
    }
    totales.set(nodo.id, t)
    return t
  }
  for (const raiz of arbol) calcular(raiz)

  // Pasada 2: emite en pre-orden (padre antes que hijos), omitiendo ramas vacías.
  const out: BalanzaNodo[] = []
  const emitir = (nodos: CuentaNode[]) => {
    for (const n of nodos) {
      const t = totales.get(n.id)
      if (!t) continue
      out.push({ cuenta: n, ...t })
      emitir(n.hijos)
    }
  }
  emitir(arbol)
  return out
}
