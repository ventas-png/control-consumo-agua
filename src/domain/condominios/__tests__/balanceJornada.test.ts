// El balance del día: cómo se LEE la diferencia entre lo esperado y lo ocurrido.
//
// QUÉ SE CUBRE. Lo que el sandbox SQL no puede ver. La aritmética —la demora por
// tramos, el exceso tipo a tipo, la medianoche— vive en la base y allí está
// probada con quince invariantes. Aquí importa otra cosa: que la frase que se
// enseña lleve su número, y que el día que TODAVÍA no se puede juzgar (jornada
// abierta, vara sin declarar) no se cuente como incumplido. Un resumen que
// contara «12 de 20 cumplen» incluyendo los turnos de esta noche que aún no
// cierran acusaría de una falta que nadie cometió.
import { describe, it, expect, vi } from 'vitest'
vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
import { hallazgosEnPalabras, resumirBalance, type BalanceDia } from '../balanceJornada'

function dia(over: Partial<BalanceDia> = {}): BalanceDia {
  return {
    personal_id: 'p1', nombre: 'Ada', cargo: 'Guardia', fecha: '2026-09-01',
    bloque_id: 'b1', turno_inicio: '06:00:00', turno_fin: '14:00:00',
    horas_planificadas: 7.25, tiene_vara: true,
    registro_id: 'r1', hora_entrada: '06:00:00', hora_salida: '14:00:00',
    horas_estadia: 8, horas_descanso: 0.75, horas_laborales: 7.25,
    minutos_tarde: 0, tramo_demora: null, minutos_salida_temprana: 0,
    minutos_exceso_descanso: 0, horas_sobre_jornada: 0,
    extra_requiere_autorizacion: true, cumple: true, hallazgos: [],
    ...over,
  }
}

describe('los hallazgos en palabras', () => {
  it('el día que cumple no dice nada', () => {
    expect(hallazgosEnPalabras(dia())).toEqual([])
  })

  it('la demora lleva su número Y su tramo: «se compensa» no es lo mismo que «se debita»', () => {
    expect(hallazgosEnPalabras(dia({
      hallazgos: ['demora'], minutos_tarde: 25, tramo_demora: 'compensable', cumple: false,
    }))).toEqual(['entró 25 min tarde (se compensa)'])
    expect(hallazgosEnPalabras(dia({
      hallazgos: ['demora'], minutos_tarde: 50, tramo_demora: 'debitada', cumple: false,
    }))).toEqual(['entró 50 min tarde (se debita)'])
  })

  it('el exceso de descanso y la salida temprana llevan sus minutos', () => {
    expect(hallazgosEnPalabras(dia({
      hallazgos: ['salida_temprana', 'exceso_descanso'],
      minutos_salida_temprana: 30, minutos_exceso_descanso: 45, cumple: false,
    }))).toEqual(['salió 30 min antes', 'excedió el descanso en 45 min'])
  })

  it('la extra se SEÑALA, y la frase dice que no está autorizada', () => {
    expect(hallazgosEnPalabras(dia({
      hallazgos: ['extra_sin_autorizar'], horas_sobre_jornada: 3.75, cumple: false,
    }))).toEqual(['3.75 h sobre la jornada, sin autorizar'])
  })

  it('lo que no se puede juzgar lo dice con esas palabras, no como incumplimiento', () => {
    expect(hallazgosEnPalabras(dia({ tiene_vara: false, hallazgos: ['sin_vara'], cumple: false })))
      .toEqual(['la jornada no declara qué espera'])
    expect(hallazgosEnPalabras(dia({ hora_salida: null, hallazgos: ['jornada_abierta'], cumple: false })))
      .toEqual(['la jornada quedó abierta'])
    expect(hallazgosEnPalabras(dia({ registro_id: null, hallazgos: ['sin_marcaje'], cumple: false })))
      .toEqual(['el turno no se cubrió'])
  })

  it('un número ausente no imprime «null min»', () => {
    expect(hallazgosEnPalabras(dia({ hallazgos: ['demora'], minutos_tarde: null, cumple: false })))
      .toEqual(['entró ? min tarde'])
  })
})

describe('el resumen de un rango', () => {
  it('solo juzga lo juzgable: la jornada abierta y el día sin vara quedan fuera', () => {
    const r = resumirBalance([
      dia(),
      dia({ fecha: '2026-09-02', cumple: false, hallazgos: ['demora'], minutos_tarde: 20, tramo_demora: 'compensable' }),
      dia({ fecha: '2026-09-03', hora_salida: null, cumple: false, hallazgos: ['jornada_abierta'] }),
      dia({ fecha: '2026-09-04', tiene_vara: false, cumple: false, hallazgos: ['sin_vara'] }),
      dia({ fecha: '2026-09-05', registro_id: null, cumple: false, hallazgos: ['sin_marcaje'] }),
    ])
    expect(r.dias).toBe(5)
    expect(r.juzgables).toBe(2)
    expect(r.cumplen).toBe(1)
  })

  it('suma los desvíos del rango, tratando los nulos como cero', () => {
    const r = resumirBalance([
      dia({ minutos_tarde: 12, minutos_exceso_descanso: 15, horas_sobre_jornada: 1.5 }),
      dia({ fecha: '2026-09-02', minutos_tarde: null, minutos_salida_temprana: 30 }),
    ])
    expect(r.minutosTarde).toBe(12)
    expect(r.minutosSalidaTemprana).toBe(30)
    expect(r.minutosExcesoDescanso).toBe(15)
    expect(r.horasSobreJornada).toBe(1.5)
  })

  it('un rango vacío no divide entre cero ni inventa cumplimiento', () => {
    expect(resumirBalance([])).toEqual({
      dias: 0, juzgables: 0, cumplen: 0,
      minutosTarde: 0, minutosSalidaTemprana: 0, minutosExcesoDescanso: 0, horasSobreJornada: 0,
    })
  })
})
