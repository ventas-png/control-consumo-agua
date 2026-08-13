import { describe, it, expect } from 'vitest'
import {
  inferirPadreCodigo,
  jerarquiaDesdeNiveles,
  parseBooleano,
  planificarCatalogo,
  validarFilaCuenta,
  type CuentaImportFila,
} from '../importCuentas'

function fila(over: Partial<CuentaImportFila> = {}): CuentaImportFila {
  return {
    codigo: '5201',
    nombre: 'Servicios básicos',
    tipo: 'gasto',
    naturaleza: 'deudora',
    padre_codigo: null,
    es_detalle: true,
    moneda: null,
    descripcion: null,
    ...over,
  }
}

/** Fila cruda en el formato de la plantilla (columnas por nivel). */
function niveles(ns: number[], resto: Record<string, unknown> = {}): Record<string, unknown> {
  const row: Record<string, unknown> = { nombre: 'Cuenta', ...resto }
  ns.forEach((n, i) => { row[`n_${i + 1}`] = n })
  return row
}

describe('jerarquiaDesdeNiveles', () => {
  it('arma código, padre y nivel desde las columnas', () => {
    const r = jerarquiaDesdeNiveles(niveles([1, 1, 1, 3, 2]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data).toEqual({ codigo: '1.1.1.3.2', padre_codigo: '1.1.1.3', nivel: 5 })
  })

  it('el nivel 1 no tiene padre', () => {
    const r = jerarquiaDesdeNiveles(niveles([1, 0, 0, 0, 0]))
    expect(r.ok && r.data).toEqual({ codigo: '1', padre_codigo: null, nivel: 1 })
  })

  it('trata la celda vacía como 0', () => {
    const r = jerarquiaDesdeNiveles({ n_1: 2, n_2: 3, n_3: '', n_4: '', n_5: '' })
    expect(r.ok && r.data.codigo).toBe('2.3')
  })

  it('rechaza un hueco entre niveles', () => {
    const r = jerarquiaDesdeNiveles(niveles([1, 0, 2, 0, 0]))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors[0]).toMatch(/nivel en 0 entre dos/i)
  })

  it('acepta las cabeceras alternativas nivel_1 y n1', () => {
    expect(jerarquiaDesdeNiveles({ nivel_1: 4, nivel_2: 2 })).toMatchObject({ ok: true, data: { codigo: '4.2' } })
    expect(jerarquiaDesdeNiveles({ n1: 5 })).toMatchObject({ ok: true, data: { codigo: '5' } })
  })

  it('rechaza la fila sin ningún nivel y los valores no enteros', () => {
    expect(jerarquiaDesdeNiveles(niveles([0, 0, 0, 0, 0])).ok).toBe(false)
    expect(jerarquiaDesdeNiveles({ n_1: 'uno' }).ok).toBe(false)
    expect(jerarquiaDesdeNiveles({ n_1: 1.5 }).ok).toBe(false)
  })
})

describe('validarFilaCuenta — formato de la plantilla (columnas por nivel)', () => {
  it('lee la jerarquía de las columnas sin pedir código ni padre', () => {
    const r = validarFilaCuenta(niveles([1, 1, 1, 1, 0], { nombre: 'Vehículos' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.codigo).toBe('1.1.1.1')
    expect(r.data.padre_codigo).toBe('1.1.1')
  })

  it('deja tipo y naturaleza vacíos para que se hereden del padre', () => {
    const r = validarFilaCuenta(niveles([1, 1, 0, 0, 0], { nombre: 'NO CORRIENTE' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.tipo).toBeNull()
    expect(r.data.naturaleza).toBeNull()
  })

  it('exige el tipo en el nivel 1, que no tiene de quién heredarlo', () => {
    const r = validarFilaCuenta(niveles([1, 0, 0, 0, 0], { nombre: 'ACTIVO' }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors[0]).toMatch(/tipo es obligatorio en el nivel 1/i)
  })

  it('acepta el nivel 1 con su tipo', () => {
    const r = validarFilaCuenta(niveles([1, 0, 0, 0, 0], { nombre: 'ACTIVO', tipo: 'activo' }))
    expect(r.ok && r.data.tipo).toBe('activo')
  })
})

describe('validarFilaCuenta — formato viejo (codigo + padre_codigo)', () => {
  it('sigue aceptando los archivos ya armados', () => {
    const r = validarFilaCuenta({ codigo: ' 5201 ', nombre: ' Energía ', tipo: 'GASTO' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.codigo).toBe('5201')
    expect(r.data.nombre).toBe('Energía')
    expect(r.data.tipo).toBe('gasto')
    expect(r.data.es_detalle).toBe(true)
  })

  it('acepta sinónimos de tipo y naturaleza', () => {
    const r = validarFilaCuenta({ codigo: '4101', nombre: 'Cuotas', tipo: 'Ingresos', naturaleza: 'Acreedor' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.tipo).toBe('ingreso')
    expect(r.data.naturaleza).toBe('acreedora')
  })

  it('normaliza monedas legacy y rechaza las inválidas', () => {
    const ok = validarFilaCuenta({ codigo: '1102-02', nombre: 'Banco USD', tipo: 'activo', moneda: '$' })
    expect(ok.ok && ok.data.moneda).toBe('USD')

    const mal = validarFilaCuenta({ codigo: '1102-02', nombre: 'Banco USD', tipo: 'activo', moneda: 'dólares' })
    expect(mal.ok).toBe(false)
    if (mal.ok) return
    expect(mal.errors[0]).toMatch(/moneda/i)
  })

  it('reporta los campos obligatorios faltantes', () => {
    const r = validarFilaCuenta({ codigo: '', nombre: 'X', tipo: 'inventado' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toHaveLength(3)
  })

  it('rechaza una cuenta que se declara padre de sí misma', () => {
    const r = validarFilaCuenta({ codigo: '11', nombre: 'Activo circulante', tipo: 'activo', padre_codigo: '11' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors[0]).toMatch(/misma cuenta/i)
  })
})

describe('parseBooleano', () => {
  it('entiende las formas usuales del sí/no', () => {
    expect(parseBooleano('Sí', true)).toBe(true)
    expect(parseBooleano('NO', true)).toBe(false)
    expect(parseBooleano('agrupadora', true)).toBe(false)
    expect(parseBooleano('', false)).toBe(false)
    expect(parseBooleano('quizá', true)).toBeNull()
  })
})

describe('inferirPadreCodigo', () => {
  it('sigue la convención del catálogo semilla', () => {
    expect(inferirPadreCodigo('1')).toBeNull()
    expect(inferirPadreCodigo('11')).toBe('1')
    expect(inferirPadreCodigo('1102')).toBe('11')
    expect(inferirPadreCodigo('1102-01')).toBe('1102')
    expect(inferirPadreCodigo('1102-01-03')).toBe('1102-01')
  })

  it('entiende también los códigos por nivel', () => {
    expect(inferirPadreCodigo('1.1.1.3')).toBe('1.1.1')
  })

  it('no infiere padre para códigos alfabéticos', () => {
    expect(inferirPadreCodigo('CAJA')).toBeNull()
  })
})

describe('planificarCatalogo', () => {
  const existentes = [
    { id: 'id-1', codigo: '1', nivel: 1, tipo: 'activo' as const, naturaleza: 'deudora' as const },
    { id: 'id-11', codigo: '11', nivel: 2, tipo: 'activo' as const, naturaleza: 'deudora' as const },
    { id: 'id-1102', codigo: '1102', nivel: 3, tipo: 'activo' as const, naturaleza: 'deudora' as const },
  ]

  /** Fila del formato nuevo: sin tipo, se hereda del padre. */
  function heredada(codigo: string, padre: string | null, over: Partial<CuentaImportFila> = {}) {
    return fila({ codigo, padre_codigo: padre, tipo: null, naturaleza: null, ...over })
  }

  it('cuelga cuentas nuevas de una cuenta ya existente del ledger', () => {
    const plan = planificarCatalogo([fila({ codigo: '1102-02', nombre: 'Banco USD', tipo: 'activo' })], existentes)
    expect(plan.crear).toHaveLength(1)
    expect(plan.crear[0]).toMatchObject({ nivel: 4, padre_codigo: '1102' })
    expect(plan.omitidas).toEqual([])
  })

  it('ordena padres antes que hijos aunque el archivo venga al revés', () => {
    const plan = planificarCatalogo(
      [
        heredada('1.1.1', '1.1', { nombre: 'Propiedad, planta y equipo' }),
        heredada('1.1', '1', { nombre: 'No corriente' }),
        fila({ codigo: '1', nombre: 'ACTIVO', tipo: 'activo', padre_codigo: null }),
      ],
      [],
    )
    expect(plan.crear.map((c) => c.cuenta.codigo)).toEqual(['1', '1.1', '1.1.1'])
    expect(plan.crear.map((c) => c.nivel)).toEqual([1, 2, 3])
  })

  it('hereda el tipo del nivel 1 por toda la rama', () => {
    const plan = planificarCatalogo(
      [
        fila({ codigo: '1', nombre: 'ACTIVO', tipo: 'activo', padre_codigo: null }),
        heredada('1.1', '1', { nombre: 'No corriente' }),
        heredada('1.1.1', '1.1', { nombre: 'Vehículos' }),
      ],
      [],
    )
    expect(plan.crear.map((c) => c.cuenta.tipo)).toEqual(['activo', 'activo', 'activo'])
    expect(plan.crear.map((c) => c.cuenta.naturaleza)).toEqual(['deudora', 'deudora', 'deudora'])
  })

  it('las hijas de una cuenta contra-natura heredan su naturaleza', () => {
    const plan = planificarCatalogo(
      [
        fila({ codigo: '1', nombre: 'ACTIVO', tipo: 'activo', padre_codigo: null }),
        heredada('1.2', '1', { nombre: 'Depreciación acumulada', naturaleza: 'acreedora' }),
        heredada('1.2.1', '1.2', { nombre: 'Depreciación vehículos' }),
      ],
      [],
    )
    const porCodigo = Object.fromEntries(plan.crear.map((c) => [c.cuenta.codigo, c.cuenta]))
    expect(porCodigo['1.2'].naturaleza).toBe('acreedora')
    expect(porCodigo['1.2.1'].naturaleza).toBe('acreedora')  // hereda, no re-deriva del tipo
    expect(porCodigo['1.2.1'].tipo).toBe('activo')
  })

  it('hereda el tipo de la cuenta ya existente cuando la rama arranca en el catálogo', () => {
    const plan = planificarCatalogo([heredada('1102.01', '1102', { nombre: 'Banco Promerica' })], existentes)
    expect(plan.crear[0].cuenta).toMatchObject({ tipo: 'activo', naturaleza: 'deudora' })
  })

  it('omite la fila sin tipo cuya rama tampoco lo define', () => {
    const plan = planificarCatalogo([heredada('9', null, { nombre: 'Huérfana' })], existentes)
    expect(plan.crear).toEqual([])
    expect(plan.omitidas[0].motivo).toMatch(/falta el tipo/i)
  })

  it('marca como agrupadora a la cuenta que tiene hijos en el archivo', () => {
    const plan = planificarCatalogo(
      [
        fila({ codigo: '52', nombre: 'Gastos', es_detalle: true }),
        fila({ codigo: '52-01', nombre: 'Agua', padre_codigo: '52', es_detalle: true }),
      ],
      [],
    )
    expect(plan.crear.find((c) => c.cuenta.codigo === '52')!.cuenta.es_detalle).toBe(false)
    expect(plan.crear.find((c) => c.cuenta.codigo === '52-01')!.cuenta.es_detalle).toBe(true)
  })

  it('sin padre_codigo y sin padre inferible, la cuenta nace como raíz', () => {
    const plan = planificarCatalogo([fila({ codigo: '52', nombre: 'Gastos de operación' })], existentes)
    expect(plan.crear).toHaveLength(1)
    expect(plan.crear[0]).toMatchObject({ nivel: 1, padre_codigo: null })
    expect(plan.omitidas).toEqual([])
  })

  it('sin padre_codigo se cuelga del padre inferido cuando ese sí existe', () => {
    const plan = planificarCatalogo([fila({ codigo: '1103', nombre: 'Caja chica', tipo: 'activo' })], existentes)
    expect(plan.crear[0]).toMatchObject({ nivel: 3, padre_codigo: '11' })
  })

  it('omite la cuenta cuyo padre no existe ni viene en el archivo', () => {
    const plan = planificarCatalogo([fila({ codigo: '9901-01', nombre: 'Huérfana', padre_codigo: '9901' })], existentes)
    expect(plan.crear).toEqual([])
    expect(plan.omitidas[0].motivo).toMatch(/9901/)
  })

  it('arrastra al hijo cuando su padre queda omitido', () => {
    const plan = planificarCatalogo(
      [
        fila({ codigo: '9901-01', nombre: 'Padre inválido', padre_codigo: '9901' }),
        fila({ codigo: '9901-01-01', nombre: 'Nieto', padre_codigo: '9901-01' }),
      ],
      existentes,
    )
    expect(plan.crear).toEqual([])
    expect(plan.omitidas).toHaveLength(2)
  })

  it('detecta referencias circulares', () => {
    const plan = planificarCatalogo(
      [
        fila({ codigo: 'A', nombre: 'Cuenta A', padre_codigo: 'B' }),
        fila({ codigo: 'B', nombre: 'Cuenta B', padre_codigo: 'A' }),
      ],
      [],
    )
    expect(plan.crear).toEqual([])
    expect(plan.omitidas.every((o) => /circular/.test(o.motivo))).toBe(true)
  })

  it('admite una rama hasta el nivel 8 y rechaza el 9', () => {
    // '1' ya existe en el ledger (nivel 1) → la rama del archivo va del 2 al 9.
    const rama = ['1.1', '1.1.1', '1.1.1.1', '1.1.1.1.1', '1.1.1.1.1.1', '1.1.1.1.1.1.1', '1.1.1.1.1.1.1.1']
    const plan = planificarCatalogo(
      [
        ...rama.map((codigo, i) => heredada(codigo, i === 0 ? '1' : rama[i - 1], { nombre: `Nivel ${i + 2}` })),
        heredada('1.1.1.1.1.1.1.1.1', '1.1.1.1.1.1.1.1', { nombre: 'Nivel 9' }),
      ],
      existentes,
    )
    expect(plan.crear.map((c) => c.nivel)).toEqual([2, 3, 4, 5, 6, 7, 8])
    expect(plan.omitidas).toHaveLength(1)
    expect(plan.omitidas[0].motivo).toMatch(/nivel máximo \(8\)/i)
  })

  it('descarta duplicados dentro del archivo y conserva la primera fila', () => {
    const plan = planificarCatalogo(
      [
        fila({ codigo: '1102-02', nombre: 'Primera', tipo: 'activo' }),
        fila({ codigo: '1102-02', nombre: 'Segunda', tipo: 'activo' }),
      ],
      existentes,
    )
    expect(plan.crear).toHaveLength(1)
    expect(plan.crear[0].cuenta.nombre).toBe('Primera')
    expect(plan.omitidas[0].motivo).toMatch(/repetido/i)
  })

  it('omite por default los códigos que ya existen en el ledger', () => {
    const plan = planificarCatalogo([fila({ codigo: '1102', nombre: 'Bancos renombrado', tipo: 'activo' })], existentes)
    expect(plan.crear).toEqual([])
    expect(plan.actualizar).toEqual([])
    expect(plan.omitidas[0].motivo).toMatch(/ya existe/i)
  })

  it('con actualizarExistentes los reporta como update sin moverlos de rama', () => {
    const plan = planificarCatalogo(
      [fila({ codigo: '1102', nombre: 'Bancos renombrado', tipo: 'activo', padre_codigo: '1' })],
      existentes,
      { actualizarExistentes: true },
    )
    expect(plan.crear).toEqual([])
    expect(plan.actualizar).toHaveLength(1)
    expect(plan.actualizar[0]).toMatchObject({ id: 'id-1102', nivel: 3 })
    expect(plan.actualizar[0].cuenta.nombre).toBe('Bancos renombrado')
    expect(plan.omitidas).toEqual([])
  })

  it('al actualizar sin tipo conserva el de la cuenta existente', () => {
    const plan = planificarCatalogo(
      [heredada('1102', null, { nombre: 'Bancos' })],
      existentes,
      { actualizarExistentes: true },
    )
    expect(plan.actualizar[0].cuenta).toMatchObject({ tipo: 'activo', naturaleza: 'deudora' })
  })

  it('el mismo archivo se replica en un ledger vacío (proyecto recién creado)', () => {
    const filas = [
      fila({ codigo: '1', nombre: 'Activo', tipo: 'activo', es_detalle: false }),
      fila({ codigo: '11', nombre: 'Activo circulante', tipo: 'activo' }),
      fila({ codigo: '1102', nombre: 'Bancos', tipo: 'activo' }),
    ]
    const enEmpresa = planificarCatalogo(filas, existentes)
    const enProyecto = planificarCatalogo(filas, [])

    expect(enEmpresa.crear).toEqual([])           // ya existen en la empresa
    expect(enProyecto.crear).toHaveLength(3)      // el proyecto arranca vacío
    expect(enProyecto.crear.map((c) => c.nivel)).toEqual([1, 2, 3])
  })
})
