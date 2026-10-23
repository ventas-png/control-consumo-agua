import { describe, it, expect } from 'vitest'
import { resumenReciclaje, variacionMismoPeriodo, TIPOS_RECICLADOS } from '../sostenibilidad'
import type { RegistroResiduo, TipoResiduo } from '../../../types'

const residuo = (tipo_residuo: TipoResiduo, cantidad_kg: number | null): RegistroResiduo => ({
  id: `${tipo_residuo}-${cantidad_kg}`, company_id: 'co1', project_id: 'p1', fecha: '2026-10-01', tipo_residuo,
  cantidad_kg, estado: 'pendiente', incidencia: false, created_at: '2026-10-01T10:00:00Z',
})

describe('resumenReciclaje', () => {
  it('cuenta lo reciclable y lo electrónico; el resto sólo suma al total', () => {
    expect([...TIPOS_RECICLADOS].sort()).toEqual(['electronico', 'reciclable'])
    const r = resumenReciclaje([
      residuo('reciclable', 30), residuo('electronico', 10),
      residuo('organico', 40), residuo('peligroso', 5), residuo('escombros', 10), residuo('general', 5),
    ])
    expect(r).toEqual({ totalKg: 100, recicladoKg: 40, pct: 40 })
  })

  it('ignora cantidades vacías, en cero, negativas o inválidas', () => {
    const r = resumenReciclaje([
      residuo('reciclable', 10), residuo('general', 10),
      residuo('reciclable', null), residuo('reciclable', 0), residuo('electronico', -5), residuo('general', Number.NaN),
    ])
    expect(r).toEqual({ totalKg: 20, recicladoKg: 10, pct: 50 })
  })

  it('sin kg registrados no hay porcentaje (no un 0 % engañoso)', () => {
    expect(resumenReciclaje([])).toEqual({ totalKg: 0, recicladoKg: 0, pct: null })
    expect(resumenReciclaje([residuo('reciclable', null)]).pct).toBeNull()
  })
})

describe('variacionMismoPeriodo', () => {
  const mov = (fecha: string, monto: number) => ({ fecha, monto })

  it('compara del 1 a hoy contra el mismo tramo del mes anterior', () => {
    const v = variacionMismoPeriodo([
      mov('2026-09-01', 100), mov('2026-09-15', 100),
      mov('2026-09-16', 999), // después del mismo día: no cuenta
      mov('2026-10-01', 150), mov('2026-10-15', 100),
      mov('2026-10-16', 999), // aún no llega (fecha futura)
      mov('2026-08-31', 999), // dos meses atrás
    ], new Date(2026, 9, 15, 18, 0))
    expect(v).toEqual({ actual: 250, anterior: 200, pct: 25, hastaActual: '2026-10-15', hastaAnterior: '2026-09-15' })
  })

  it('el 31 de marzo compara contra todo febrero', () => {
    const v = variacionMismoPeriodo([mov('2026-02-28', 80), mov('2026-03-31', 40)], new Date(2026, 2, 31, 9, 0))
    expect(v.hastaAnterior).toBe('2026-02-28')
    expect(v).toMatchObject({ actual: 40, anterior: 80, pct: -50 })
  })

  it('en enero compara contra diciembre del año anterior', () => {
    const v = variacionMismoPeriodo([mov('2025-12-05', 200), mov('2026-01-05', 100)], new Date(2026, 0, 10))
    expect(v).toMatchObject({ actual: 100, anterior: 200, pct: -50, hastaAnterior: '2025-12-10' })
  })

  it('sin nada en el mes anterior no hay porcentaje', () => {
    const v = variacionMismoPeriodo([mov('2026-10-02', 500)], new Date(2026, 9, 15))
    expect(v).toMatchObject({ actual: 500, anterior: 0, pct: null })
  })

  it('lee la fecha aunque traiga hora e ignora montos o fechas inválidos', () => {
    const v = variacionMismoPeriodo([
      mov('2026-09-15T22:00:00', 100), mov('2026-10-03', 50),
      { fecha: null, monto: 999 }, mov('2026-10-04', Number.NaN),
    ], new Date(2026, 9, 15))
    expect(v).toMatchObject({ actual: 50, anterior: 100, pct: -50 })
  })
})
