import { describe, it, expect } from 'vitest'
import {
  inferirPadreCodigo,
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

describe('validarFilaCuenta', () => {
  it('normaliza una fila mínima y deriva la naturaleza del tipo', () => {
    const r = validarFilaCuenta({ codigo: ' 5201 ', nombre: ' Energía ', tipo: 'GASTO' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.codigo).toBe('5201')
    expect(r.data.nombre).toBe('Energía')
    expect(r.data.naturaleza).toBe('deudora')
    expect(r.data.es_detalle).toBe(true)
    expect(r.data.moneda).toBeNull()
  })

  it('acepta sinónimos de tipo y naturaleza', () => {
    const r = validarFilaCuenta({ codigo: '4101', nombre: 'Cuotas', tipo: 'Ingresos', naturaleza: 'Acreedor' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.tipo).toBe('ingreso')
    expect(r.data.naturaleza).toBe('acreedora')
  })

  it('permite naturaleza contra-natura (depreciación acumulada)', () => {
    const r = validarFilaCuenta({ codigo: '1205', nombre: 'Depreciación acumulada', tipo: 'activo', naturaleza: 'acreedora' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
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

  it('no infiere padre para códigos alfabéticos', () => {
    expect(inferirPadreCodigo('CAJA')).toBeNull()
  })
})

describe('planificarCatalogo', () => {
  const existentes = [
    { id: 'id-1', codigo: '1', nivel: 1 },
    { id: 'id-11', codigo: '11', nivel: 2 },
    { id: 'id-1102', codigo: '1102', nivel: 3 },
  ]

  it('cuelga cuentas nuevas de una cuenta ya existente del ledger', () => {
    const plan = planificarCatalogo([fila({ codigo: '1102-02', nombre: 'Banco USD', tipo: 'activo' })], existentes)
    expect(plan.crear).toHaveLength(1)
    expect(plan.crear[0]).toMatchObject({ nivel: 4, padre_codigo: '1102' })
    expect(plan.omitidas).toEqual([])
  })

  it('ordena padres antes que hijos aunque el archivo venga al revés', () => {
    const plan = planificarCatalogo(
      [
        fila({ codigo: '52-01-01', nombre: 'Agua potable', padre_codigo: '52-01' }),
        fila({ codigo: '52-01', nombre: 'Servicios', padre_codigo: '52' }),
        fila({ codigo: '52', nombre: 'Gastos de operación', padre_codigo: null }),
      ],
      [],
    )
    expect(plan.crear.map((c) => c.fila.codigo)).toEqual(['52', '52-01', '52-01-01'])
    expect(plan.crear.map((c) => c.nivel)).toEqual([1, 2, 3])
  })

  it('marca como agrupadora a la cuenta que tiene hijos en el archivo', () => {
    const plan = planificarCatalogo(
      [
        fila({ codigo: '52', nombre: 'Gastos', es_detalle: true }),
        fila({ codigo: '52-01', nombre: 'Agua', padre_codigo: '52', es_detalle: true }),
      ],
      [],
    )
    expect(plan.crear.find((c) => c.fila.codigo === '52')!.fila.es_detalle).toBe(false)
    expect(plan.crear.find((c) => c.fila.codigo === '52-01')!.fila.es_detalle).toBe(true)
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

  it('rechaza pasar del nivel 5', () => {
    const plan = planificarCatalogo(
      [
        fila({ codigo: '1102-01-01', nombre: 'Nivel 5', padre_codigo: '1102-01' }),
        fila({ codigo: '1102-01', nombre: 'Nivel 4', padre_codigo: '1102' }),
        fila({ codigo: '1102-01-01-01', nombre: 'Nivel 6', padre_codigo: '1102-01-01' }),
      ],
      existentes,
    )
    expect(plan.crear.map((c) => c.fila.codigo)).toEqual(['1102-01', '1102-01-01'])
    expect(plan.omitidas).toHaveLength(1)
    expect(plan.omitidas[0].motivo).toMatch(/nivel máximo/i)
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
    expect(plan.crear[0].fila.nombre).toBe('Primera')
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
    expect(plan.omitidas).toEqual([])
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
