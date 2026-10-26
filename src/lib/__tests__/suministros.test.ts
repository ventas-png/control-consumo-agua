import { describe, it, expect } from 'vitest'
import {
  consumoObservado, describirRendimiento, fmtRendimiento, rendimientoSuministro, restarDiasISO,
} from '../suministros'

const alcohol = {
  unidad_medida: 'litro' as const, stock_actual: 1, stock_minimo: 1, costo_unitario: 6,
  rendimiento: 40, rendimiento_unidad: 'aplicaciones',
}

describe('rendimientoSuministro', () => {
  it('traduce el stock a usos y el costo a costo por uso', () => {
    expect(rendimientoSuministro(alcohol)).toEqual({
      porUnidad: 40, unidad: 'aplicaciones', usosDisponibles: 40, usosMinimo: 40, costoPorUso: 0.15,
    })
    expect(rendimientoSuministro({ ...alcohol, stock_actual: 2.5, stock_minimo: 0.5 }))
      .toMatchObject({ usosDisponibles: 100, usosMinimo: 20 })
  })

  it('sin rendimiento (o con uno inválido) no hay nada que derivar', () => {
    expect(rendimientoSuministro({ ...alcohol, rendimiento: null })).toBeNull()
    expect(rendimientoSuministro({ ...alcohol, rendimiento: undefined })).toBeNull()
    expect(rendimientoSuministro({ ...alcohol, rendimiento: 0 })).toBeNull()
    expect(rendimientoSuministro({ ...alcohol, rendimiento: -3 })).toBeNull()
    expect(rendimientoSuministro({ ...alcohol, rendimiento: Number.NaN })).toBeNull()
  })

  it('la unidad vacía cae en «usos» y el costo ausente deja el costo por uso en null', () => {
    expect(rendimientoSuministro({ ...alcohol, rendimiento_unidad: '  ' })).toMatchObject({ unidad: 'usos' })
    expect(rendimientoSuministro({ ...alcohol, rendimiento_unidad: null })).toMatchObject({ unidad: 'usos' })
    expect(rendimientoSuministro({ ...alcohol, costo_unitario: null })).toMatchObject({ costoPorUso: null })
  })

  it('describe el rendimiento en una frase', () => {
    expect(describirRendimiento(alcohol)).toBe('1 litro rinde 40 aplicaciones')
    expect(describirRendimiento({ ...alcohol, rendimiento: 2.5, rendimiento_unidad: 'días' })).toBe('1 litro rinde 2.5 días')
    expect(describirRendimiento({ ...alcohol, rendimiento: null })).toBeNull()
  })

  it('fmtRendimiento no arrastra ceros', () => {
    expect(fmtRendimiento(40)).toBe('40')
    expect(fmtRendimiento(0.1499)).toBe('0.15')
    expect(fmtRendimiento(1 / 3, 4)).toBe('0.3333')
  })
})

describe('consumoObservado', () => {
  const hoy = '2026-10-26'
  const mov = (tipo: 'entrada' | 'salida' | 'ajuste', cantidad: number, fecha: string) => ({ tipo, cantidad, fecha })

  it('suma sólo las salidas dentro de la ventana y estima la cobertura', () => {
    const c = consumoObservado(3, [
      mov('salida', 1, '2026-10-19'),
      mov('salida', 2, '2026-10-01'),
      mov('salida', 5, '2026-09-26'),   // 31 días atrás: fuera de la ventana de 30
      mov('entrada', 10, '2026-10-20'), // repone, no consume
      mov('ajuste', 4, '2026-10-21'),   // corrige, no consume
      mov('salida', 9, '2026-10-27'),   // mañana: no cuenta
    ], hoy)
    expect(c).toEqual({ dias: 30, movimientos: 2, salidas: 3, porDia: 0.1, diasCobertura: 30 })
  })

  it('el primer día de la ventana cuenta (30 días, hoy incluido)', () => {
    expect(consumoObservado(1, [mov('salida', 1, '2026-09-27')], hoy)).toMatchObject({ movimientos: 1, salidas: 1 })
    expect(consumoObservado(1, [mov('salida', 1, '2026-09-26')], hoy)).toMatchObject({ movimientos: 0, salidas: 0 })
  })

  it('sin salidas no hay ritmo ni cobertura', () => {
    expect(consumoObservado(5, [mov('entrada', 2, hoy)], hoy)).toEqual({
      dias: 30, movimientos: 0, salidas: 0, porDia: 0, diasCobertura: null,
    })
  })

  it('la ventana se puede cambiar', () => {
    const c = consumoObservado(10, [mov('salida', 7, '2026-10-20'), mov('salida', 7, '2026-10-01')], hoy, 7)
    expect(c).toEqual({ dias: 7, movimientos: 1, salidas: 7, porDia: 1, diasCobertura: 10 })
  })

  it('restarDiasISO cruza meses y años sin zona horaria', () => {
    expect(restarDiasISO('2026-10-26', 29)).toBe('2026-09-27')
    expect(restarDiasISO('2026-01-01', 1)).toBe('2025-12-31')
    expect(restarDiasISO('2026-03-01', 1)).toBe('2026-02-28')
  })
})
