// El desglose de una jornada: estadía, descanso y horas laborales.
//
// POR QUÉ ESTAS PRUEBAS Y NO OTRAS. Lo que se comprueba aquí es el GEMELO en
// TypeScript de lo que `calcular_horas_personal` hace en SQL. Los dos números
// tienen que coincidir, y la razón para insistir es concreta: #839 fue
// exactamente eso —la misma jornada valía 24 h en la pantalla y 0.01 h en el
// cómputo— porque cada lado tenía su propia aritmética y nadie los comparó.
//
// Los casos elegidos son los que rompieron algo alguna vez o los que romperían
// una planilla: el cruce de medianoche, la pausa que no descuenta, la pausa
// abierta que todavía no dura nada, y la anulada que dejó de contar.
import { describe, it, expect, vi } from 'vitest'
// El módulo importa el cliente para sus funciones de red; lo que se prueba aquí
// es aritmética pura y no toca ninguna.
vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
import { desglose, minutosPausa, pausasVigentes } from '../pausasPresencia'
import type { PausaPresencia } from '../../../types'

function p(extra: Partial<PausaPresencia> = {}): PausaPresencia {
  return {
    id: 'pa', registro_id: 'r1', personal_id: 'per-1', tipo: 'almuerzo', etiqueta: 'Almuerzo',
    descuenta: true, inicio_en: null, fin_en: null, minutos: 60,
    origen: 'autoservicio', cerrada_al_salir: false, ...extra,
  }
}

describe('qué pausas cuentan', () => {
  it('la anulada no cuenta: anular DEVUELVE horas pagadas', () => {
    expect(pausasVigentes([p(), p({ id: 'x', anulado_en: '2026-09-08T20:00:00Z' })])).toHaveLength(1)
  })

  it('la abierta tampoco: todavía no dura nada medible', () => {
    // Contarla como cero está bien; contarla con la duración de una versión
    // anterior la haría contar dos veces al cerrarse.
    expect(pausasVigentes([p({ minutos: null })])).toHaveLength(0)
  })

  it('separa el total de lo descontable', () => {
    const r = minutosPausa([
      p({ id: 'a', minutos: 60, descuenta: true }),
      p({ id: 'b', minutos: 30, descuenta: false, tipo: 'refaccion' }),
    ])
    expect(r).toEqual({ total: 90, descontables: 60 })
  })
})

describe('el desglose de la jornada', () => {
  it('estadía menos lo que descuenta = horas laborales', () => {
    expect(desglose('06:00:00', '14:00:00', [p({ minutos: 60 })]))
      .toEqual({ estadia: 8, descanso: 1, laborales: 7 })
  })

  it('una pausa que NO descuenta se mide, pero no resta', () => {
    // El guardia que come sin poder dejar el puesto: esas horas se trabajan.
    expect(desglose('06:00:00', '14:00:00', [p({ descuenta: false, minutos: 30 })]))
      .toEqual({ estadia: 8, descanso: 0.5, laborales: 8 })
  })

  it('sin pausas, laborales y estadía son el mismo número', () => {
    expect(desglose('06:00:00', '14:00:00', [])).toEqual({ estadia: 8, descanso: 0, laborales: 8 })
  })

  it('el turno nocturno se mide entero, no en negativo', () => {
    // 22:00 → 06:00 son 8 horas. Restado a pelo da −16 y la fila desaparecía de
    // pantalla; `horasJornada` lee `fin <= inicio` como cruce de medianoche,
    // igual que `turnos_horas_jornada` en SQL.
    expect(desglose('22:00:00', '06:00:00', [p({ minutos: 60 })]))
      .toEqual({ estadia: 8, descanso: 1, laborales: 7 })
  })

  it('los segundos cuentan: 34 segundos no son 24 horas', () => {
    // El bug de #839, en su forma exacta. Con los segundos truncados,
    // 06:02:07 y 06:02:41 daban el mismo minuto y `fin <= inicio` disparaba el
    // cruce de medianoche.
    const { estadia } = desglose('06:02:07', '06:02:41', [])
    expect(estadia).toBe(0.01)
  })

  it('una pausa más larga que la jornada no produce horas negativas', () => {
    // Un ajuste con el dedo torcido no puede dejar la planilla en rojo. Es el
    // mismo GREATEST(0, …) que aplica calcular_horas_personal.
    expect(desglose('06:00:00', '08:00:00', [p({ minutos: 600 })]).laborales).toBe(0)
  })

  it('sin salida no hay jornada que desglosar, pero el descanso ya se sabe', () => {
    const r = desglose('06:00:00', null, [p({ minutos: 45 })])
    expect(r.estadia).toBeNull()
    expect(r.laborales).toBeNull()
    expect(r.descanso).toBe(0.75)
  })

  it('varias pausas se suman', () => {
    const r = desglose('06:00:00', '18:00:00', [
      p({ id: 'a', tipo: 'refaccion', descuenta: false, minutos: 20 }),
      p({ id: 'b', tipo: 'almuerzo', descuenta: true, minutos: 45 }),
      p({ id: 'c', tipo: 'cena', descuenta: true, minutos: 30 }),
    ])
    expect(r.estadia).toBe(12)
    expect(r.descanso).toBe(1.58)
    expect(r.laborales).toBe(10.75)
  })
})
