import { describe, expect, it } from 'vitest'
import { leerFecha, leerMonto, leerPeriodo, parsearCuotasPegadas } from '../saldosInicialesResidente'

const unidades = [
  { id: 'u14', nombre: 'Casa 14' },
  { id: 'u15', nombre: 'Casa 15' },
  { id: 'd1', nombre: 'Local A' },
  { id: 'd2', nombre: 'local a' },
]

describe('lectores', () => {
  it('monto: acepta miles con coma, símbolo de moneda y redondea a centavos', () => {
    expect(leerMonto('1,250.50')).toBe(1250.5)
    expect(leerMonto('Q 600')).toBe(600)
    expect(leerMonto('0.105')).toBe(0.11)
    expect(leerMonto('abc')).toBeNull()
    expect(leerMonto('')).toBeNull()
  })
  it('periodo: AAAA-MM o MM/AAAA; rechaza meses que no existen', () => {
    expect(leerPeriodo('2026-02')).toBe('2026-02')
    expect(leerPeriodo('2/2026')).toBe('2026-02')
    expect(leerPeriodo('2026/11')).toBe('2026-11')
    expect(leerPeriodo('2026-13')).toBeNull()
    expect(leerPeriodo('febrero')).toBeNull()
  })
  it('fecha: día/mes/año o ISO; rechaza fechas que no existen', () => {
    expect(leerFecha('15/02/2026')).toBe('2026-02-15')
    expect(leerFecha('2026-2-5')).toBe('2026-02-05')
    expect(leerFecha('31/02/2026')).toBeNull()
    expect(leerFecha('02/2026')).toBeNull()
  })
})

describe('parsearCuotasPegadas', () => {
  it('lee lo copiado de Excel, salta el encabezado y los renglones vacíos', () => {
    const r = parsearCuotasPegadas(
      'Unidad\tPeriodo\tMonto\tVencimiento\tMora\tTipo\n' +
      'casa 14\t2026-02\t600.00\t15/02/2026\t25\t\n' +
      '\n' +
      'CASA 15\t03/2026\t1,250.00\t\t\textraordinaria\n',
      unidades,
    )
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ linea: 2, error: null })
    expect(r[0].input).toEqual({ unidad_id: 'u14', periodo: '2026-02', monto: 600, fecha_vencimiento: '2026-02-15', mora: 25, tipo_cargo: 'mantenimiento' })
    expect(r[1].linea).toBe(4)
    expect(r[1].input).toEqual({ unidad_id: 'u15', periodo: '2026-03', monto: 1250, fecha_vencimiento: null, mora: 0, tipo_cargo: 'cuota_extraordinaria' })
  })

  it('también acepta punto y coma como separador', () => {
    const r = parsearCuotasPegadas('Casa 14;2026-04;650', unidades)
    expect(r[0].input).toMatchObject({ unidad_id: 'u14', periodo: '2026-04', monto: 650 })
  })

  it('cada renglón ilegible lleva su motivo y no se envía', () => {
    const r = parsearCuotasPegadas(
      ['Casa 99\t2026-02\t600', 'Local A\t2026-02\t600', 'Casa 14\tfebrero\t600', 'Casa 14\t2026-02\t0',
        'Casa 14\t2026-02\t600\t31/02/2026', 'Casa 14\t2026-02\t600\t\t-5', 'Casa 14\t2026-02\t600\t\t\tmulta', '\t2026-02\t600'].join('\n'),
      unidades,
    )
    expect(r.every((f) => f.input === null)).toBe(true)
    expect(r.map((f) => f.error)).toEqual([
      expect.stringMatching(/No hay una unidad llamada «Casa 99»/),
      expect.stringMatching(/más de una unidad/),
      expect.stringMatching(/periodo/),
      expect.stringMatching(/monto/),
      expect.stringMatching(/vencimiento/),
      expect.stringMatching(/mora/),
      expect.stringMatching(/tipo/),
      expect.stringMatching(/Falta la unidad/),
    ])
  })
})
