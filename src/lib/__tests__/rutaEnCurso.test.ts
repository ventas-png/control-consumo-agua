import { describe, it, expect } from 'vitest'
import {
  leerRutaEnCurso, iniciarRutaEnCurso, guardarProgresoRuta, limpiarRutaEnCurso,
  indiceDeReanudacion, RUTA_EN_CURSO_TTL_MS, type RutaEnCursoStorage,
} from '../rutaEnCurso'

function memoria(): RutaEnCursoStorage & { valor: string | null } {
  const s = {
    valor: null as string | null,
    leer: () => s.valor,
    escribir: (v: string | null) => { s.valor = v },
  }
  return s
}

const T0 = 1_800_000_000_000

describe('rutaEnCurso — la posición de la ruta sobrevive a una recarga', () => {
  it('guarda el avance y lo devuelve tal cual', () => {
    const st = memoria()
    iniciarRutaEnCurso(st, 'r1', 'u1', T0)
    guardarProgresoRuta(st, 'r1', { index: 3, leidos: new Set(['c1', 'c2']) }, T0 + 1000)
    expect(leerRutaEnCurso(st, T0 + 2000)).toEqual({
      rutaId: 'r1', userId: 'u1', index: 3, leidos: ['c1', 'c2'], actualizadaEn: T0 + 1000,
    })
  })

  it('volver a ejecutar la MISMA ruta retoma; ejecutar otra empieza de cero', () => {
    const st = memoria()
    iniciarRutaEnCurso(st, 'r1', 'u1', T0)
    guardarProgresoRuta(st, 'r1', { index: 4, leidos: ['c1'] }, T0)
    expect(iniciarRutaEnCurso(st, 'r1', 'u1', T0 + 5).index).toBe(4)
    expect(iniciarRutaEnCurso(st, 'r2', 'u1', T0 + 6)).toMatchObject({ rutaId: 'r2', index: 0, leidos: [] })
  })

  it('el progreso de un usuario no se le retoma a otro', () => {
    const st = memoria()
    iniciarRutaEnCurso(st, 'r1', 'u1', T0)
    guardarProgresoRuta(st, 'r1', { index: 4, leidos: ['c1'] }, T0)
    expect(iniciarRutaEnCurso(st, 'r1', 'u2', T0 + 5)).toMatchObject({ userId: 'u2', index: 0, leidos: [] })
  })

  it('no pisa el progreso de la ruta en curso con el de otra ruta', () => {
    const st = memoria()
    iniciarRutaEnCurso(st, 'r1', 'u1', T0)
    guardarProgresoRuta(st, 'r-otra', { index: 9, leidos: [] }, T0)
    expect(leerRutaEnCurso(st, T0)?.index).toBe(0)
  })

  it('caduca sin actividad, se limpia a mano y tolera basura', () => {
    const st = memoria()
    iniciarRutaEnCurso(st, 'r1', 'u1', T0)
    expect(leerRutaEnCurso(st, T0 + RUTA_EN_CURSO_TTL_MS + 1)).toBeNull()
    expect(leerRutaEnCurso(st, T0 + RUTA_EN_CURSO_TTL_MS)).not.toBeNull()
    limpiarRutaEnCurso(st)
    expect(st.valor).toBeNull()
    st.valor = '{no es json'
    expect(leerRutaEnCurso(st, T0)).toBeNull()
    st.valor = JSON.stringify({ rutaId: 5 })
    expect(leerRutaEnCurso(st, T0)).toBeNull()
  })
})

describe('indiceDeReanudacion', () => {
  const paradas = [['a'], ['b'], ['c'], ['d']].map(contadorIds => ({ contadorIds }))

  it('retoma en el índice guardado si esa parada sigue pendiente', () => {
    expect(indiceDeReanudacion(paradas, 2, new Set(['a', 'b']))).toBe(2)
  })

  it('salta la parada cuya lectura ya se guardó antes de la recarga', () => {
    // Guardó «c» (índice 2) y la app se recargó antes de avanzar.
    expect(indiceDeReanudacion(paradas, 2, new Set(['a', 'b', 'c']))).toBe(3)
  })

  it('una unidad con varios contadores sigue pendiente hasta leerlos todos', () => {
    const p = [{ contadorIds: ['a1', 'a2'] }, { contadorIds: ['b'] }]
    expect(indiceDeReanudacion(p, 0, new Set(['a1']))).toBe(0)
    expect(indiceDeReanudacion(p, 0, new Set(['a1', 'a2']))).toBe(1)
  })

  it('una parada sin contadores no se da por leída', () => {
    expect(indiceDeReanudacion([{ contadorIds: [] }, { contadorIds: ['b'] }], 0, new Set())).toBe(0)
  })

  it('devuelve paradas.length cuando ya no queda nada, y acota índices fuera de rango', () => {
    expect(indiceDeReanudacion(paradas, 3, new Set(['d']))).toBe(4)
    expect(indiceDeReanudacion(paradas, 99, new Set())).toBe(4)
    expect(indiceDeReanudacion(paradas, -3, new Set())).toBe(0)
  })
})
