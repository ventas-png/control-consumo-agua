import { describe, it, expect } from 'vitest'
import { ultimaMuestraPorFuente, estadoMuestreo, MUESTREO_META } from '../muestreo'

describe('ultimaMuestraPorFuente (serv:S26)', () => {
  it('toma la fecha más reciente por fuente (ignora la hora)', () => {
    const m = ultimaMuestraPorFuente([
      { fuente_id: 'a', fecha: '2026-05-01T10:00' },
      { fuente_id: 'a', fecha: '2026-05-20T08:30' },
      { fuente_id: 'b', fecha: '2026-04-15' },
    ])
    expect(m.get('a')).toBe('2026-05-20')
    expect(m.get('b')).toBe('2026-04-15')
  })

  it('ignora registros sin fuente o sin fecha', () => {
    const m = ultimaMuestraPorFuente([
      { fuente_id: '', fecha: '2026-01-01' },
      { fuente_id: 'x', fecha: '' },
    ])
    expect(m.size).toBe(0)
  })
})

describe('estadoMuestreo (serv:S26)', () => {
  it('sin frecuencia (null o ≤0) → sin_programa', () => {
    expect(estadoMuestreo('2026-05-01', null, '2026-05-10').estado).toBe('sin_programa')
    expect(estadoMuestreo('2026-05-01', 0, '2026-05-10').estado).toBe('sin_programa')
  })

  it('con programa pero sin muestras → sin_muestras', () => {
    expect(estadoMuestreo(null, 30, '2026-05-10').estado).toBe('sin_muestras')
  })

  it('próxima fecha = última + frecuencia', () => {
    expect(estadoMuestreo('2026-05-01', 30, '2026-05-10').proximaFecha).toBe('2026-05-31')
  })

  it('vencido cuando hoy pasó la próxima fecha (días negativos)', () => {
    const r = estadoMuestreo('2026-05-01', 30, '2026-06-05')
    expect(r.estado).toBe('vencido')
    expect(r.dias).toBe(-5)
  })

  it('próximo dentro de la ventana (≈20% de la frecuencia)', () => {
    // freq 30 → ventana ceil(6)=6; próxima 2026-05-31; hoy 2026-05-28 → dias 3 ≤ 6
    expect(estadoMuestreo('2026-05-01', 30, '2026-05-28').estado).toBe('proximo')
  })

  it('al_dia cuando falta más que la ventana', () => {
    // hoy 2026-05-10 → dias 21 > 6
    expect(estadoMuestreo('2026-05-01', 30, '2026-05-10').estado).toBe('al_dia')
  })

  it('MUESTREO_META cubre todos los estados', () => {
    expect(Object.keys(MUESTREO_META).sort()).toEqual(
      ['al_dia', 'proximo', 'sin_muestras', 'sin_programa', 'vencido'],
    )
  })
})
