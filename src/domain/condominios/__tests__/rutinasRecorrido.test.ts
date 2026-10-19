// Reglas del recorrido de una rutina (20261102000000), sin React ni arrastres:
// cada gesto del editor es una de estas funciones.
import { describe, it, expect } from 'vitest'
import type { PlantillaTareaCargo, RutinaActividad, RutinaArea } from '../../../types'
import {
  alternarObligatoria, destinoVecino, formatearMinutos, horaMas, insertarActividad, insertarParada,
  minutosJornada, mismoRecorrido, moverActividad, moverParada, quitarActividad,
  quitarParada, recorridoDesdeFilas, tiempoRecorrido, type Recorrido,
} from '../rutinasRecorrido'

const paso = (id: string, obligatoria = true) => ({ plantilla_tarea_id: id, obligatoria })
/** Recorrido legible: 'A1:barrer,vidrios' por parada; '-' es el grupo legado. */
function rec(...paradas: string[]): Recorrido {
  return paradas.map(p => {
    const [area, acts = ''] = p.split(':')
    return {
      area_id: area === '-' ? null : area,
      actividades: acts ? acts.split(',').map(a => paso(a.replace('?', ''), !a.endsWith('?'))) : [],
    }
  })
}
const texto = (r: Recorrido) =>
  r.map(p => `${p.area_id ?? '-'}:${p.actividades.map(a => a.plantilla_tarea_id + (a.obligatoria ? '' : '?')).join(',')}`)

describe('recorridoDesdeFilas', () => {
  const parada = (id: string, area: string, orden: number): RutinaArea => ({
    id, company_id: 'c', project_id: 'p', rutina_id: 'r1', area_id: area, orden,
    created_at: '2026-01-01T00:00:00Z',
  })
  const fila = (id: string, plantilla: string, orden: number, rutina_area_id: string | null, rutina = 'r1'): RutinaActividad => ({
    id, company_id: 'c', project_id: 'p', rutina_id: rutina, rutina_area_id, plantilla_tarea_id: plantilla,
    orden, obligatoria: plantilla !== 'opcional', created_at: '2026-01-01T00:00:00Z',
  })

  it('ordena las paradas y sus pasos, con la misma actividad en varias áreas', () => {
    const r = recorridoDesdeFilas('r1',
      [parada('z2', 'A2', 1), parada('z1', 'A1', 0), parada('zx', 'AX', 0)].map((p, i) => (i === 2 ? { ...p, rutina_id: 'otra' } : p)),
      [fila('f3', 'barrer', 0, 'z2'), fila('f2', 'vidrios', 1, 'z1'), fila('f1', 'barrer', 0, 'z1'), fila('f9', 'x', 0, null, 'otra')])
    expect(texto(r)).toEqual(['A1:barrer,vidrios', 'A2:barrer'])
  })

  it('los pasos sin parada (rutinas de antes) forman el grupo legado, primero', () => {
    const r = recorridoDesdeFilas('r1', [parada('z1', 'A1', 0)],
      [fila('f1', 'vidrios', 0, 'z1'), fila('f2', 'opcional', 1, null), fila('f3', 'barrer', 0, null)])
    expect(texto(r)).toEqual(['-:barrer,opcional?', 'A1:vidrios'])
  })
})

describe('paradas', () => {
  it('insertar: al final por defecto, en medio si se indica, nunca repetida', () => {
    const r = rec('A1:', 'A2:')
    expect(texto(insertarParada(r, 'A3'))).toEqual(['A1:', 'A2:', 'A3:'])
    expect(texto(insertarParada(r, 'A3', 1))).toEqual(['A1:', 'A3:', 'A2:'])
    expect(insertarParada(r, 'A2')).toBe(r)
  })

  it('insertar nunca antes del grupo legado', () => {
    expect(texto(insertarParada(rec('-:x', 'A1:'), 'A3', 0))).toEqual(['-:x', 'A3:', 'A1:'])
  })

  it('mover deja la parada ANTES de la que ocupaba el destino (línea de inserción)', () => {
    const r = rec('A1:', 'A2:', 'A3:', 'A4:')
    expect(texto(moverParada(r, 0, 3))).toEqual(['A2:', 'A3:', 'A1:', 'A4:'])
    expect(texto(moverParada(r, 0, 4))).toEqual(['A2:', 'A3:', 'A4:', 'A1:'])
    expect(texto(moverParada(r, 3, 0))).toEqual(['A4:', 'A1:', 'A2:', 'A3:'])
    // Soltar sobre su propio lugar (antes de sí misma o de la siguiente) no cambia nada.
    expect(moverParada(r, 1, 1)).toBe(r)
    expect(moverParada(r, 1, 2)).toBe(r)
  })

  it('el grupo legado no se mueve ni deja que algo lo pase', () => {
    const r = rec('-:x', 'A1:', 'A2:')
    expect(moverParada(r, 0, 3)).toBe(r)
    expect(texto(moverParada(r, 2, 0))).toEqual(['-:x', 'A2:', 'A1:'])
  })

  it('quitar se lleva la parada con sus actividades', () => {
    expect(texto(quitarParada(rec('A1:barrer', 'A2:'), 0))).toEqual(['A2:'])
  })
})

describe('actividades', () => {
  it('insertar en una parada; la misma en otra parada sí, dos veces en la misma no', () => {
    const r = rec('A1:barrer', 'A2:')
    expect(texto(insertarActividad(r, 1, 'barrer'))).toEqual(['A1:barrer', 'A2:barrer'])
    expect(texto(insertarActividad(r, 0, 'vidrios', 0))).toEqual(['A1:vidrios,barrer', 'A2:'])
    expect(insertarActividad(r, 0, 'barrer')).toBe(r)
  })

  it('nada se agrega al grupo legado', () => {
    const r = rec('-:x', 'A1:')
    expect(insertarActividad(r, 0, 'y')).toBe(r)
  })

  it('mover dentro de la parada', () => {
    const r = rec('A1:a,b,c')
    expect(texto(moverActividad(r, { parada: 0, indice: 0 }, { parada: 0, indice: 3 }))).toEqual(['A1:b,c,a'])
    expect(texto(moverActividad(r, { parada: 0, indice: 2 }, { parada: 0, indice: 0 }))).toEqual(['A1:c,a,b'])
    expect(moverActividad(r, { parada: 0, indice: 1 }, { parada: 0, indice: 2 })).toBe(r)
  })

  it('pasar a otra parada conserva la obligatoriedad, salvo que allá ya esté', () => {
    const r = rec('A1:a?,b', 'A2:c', 'A3:b')
    expect(texto(moverActividad(r, { parada: 0, indice: 0 }, { parada: 1, indice: 0 }))).toEqual(['A1:b', 'A2:a?,c', 'A3:b'])
    expect(moverActividad(r, { parada: 0, indice: 1 }, { parada: 2, indice: 0 })).toBe(r)
  })

  it('vaciar el grupo legado arrastrando lo hace desaparecer', () => {
    const r = rec('-:x', 'A1:')
    expect(texto(moverActividad(r, { parada: 0, indice: 0 }, { parada: 1, indice: 0 }))).toEqual(['A1:x'])
    expect(texto(quitarActividad(r, 0, 0))).toEqual(['A1:'])
  })

  it('subir/bajar con botones cruza al área vecina en el borde', () => {
    const r = rec('A1:a,b', 'A2:c')
    expect(destinoVecino(r, { parada: 0, indice: 1 }, -1)).toEqual({ parada: 0, indice: 0 })
    expect(destinoVecino(r, { parada: 0, indice: 0 }, 1)).toEqual({ parada: 0, indice: 2 })
    // Bajar la última de A1 la lleva al principio de A2; subir la primera de A2, al final de A1.
    expect(destinoVecino(r, { parada: 0, indice: 1 }, 1)).toEqual({ parada: 1, indice: 0 })
    expect(destinoVecino(r, { parada: 1, indice: 0 }, -1)).toEqual({ parada: 0, indice: 2 })
    expect(texto(moverActividad(r, { parada: 1, indice: 0 }, destinoVecino(r, { parada: 1, indice: 0 }, -1)!)))
      .toEqual(['A1:a,b,c', 'A2:'])
    // Sin vecina, o con la actividad ya en la vecina: no hay a dónde ir.
    expect(destinoVecino(r, { parada: 0, indice: 0 }, -1)).toBeNull()
    expect(destinoVecino(rec('A1:a', 'A2:a'), { parada: 0, indice: 0 }, 1)).toBeNull()
    expect(destinoVecino(rec('-:x', 'A1:a'), { parada: 1, indice: 0 }, -1)).toBeNull()
  })

  it('alternar obligatoria', () => {
    expect(texto(alternarObligatoria(rec('A1:a,b'), 0, 1))).toEqual(['A1:a,b?'])
  })
})

describe('tiempo acumulado', () => {
  const act = (id: string, min: number | null) => [id, { id, duracion_estimada_min: min } as PlantillaTareaCargo] as const
  const porPlantilla = new Map([act('barrer', 5), act('vidrios', 2), act('sin', null)])

  it('cada parada suma sus actividades y arranca donde terminó la anterior', () => {
    const t = tiempoRecorrido(rec('A1:barrer,vidrios', 'A2:barrer,sin', 'A3:'), porPlantilla)
    expect(t.porParada.map(p => [p.minutos, p.desde, p.hasta, p.sinDato])).toEqual([
      [7, 0, 7, 0], [5, 7, 12, 1], [0, 12, 12, 0],
    ])
    expect(t).toMatchObject({ paradas: 3, pasos: 4, minutos: 12, sinDato: 1 })
  })

  it('el grupo legado suma tiempo pero no cuenta como área', () => {
    expect(tiempoRecorrido(rec('-:barrer', 'A1:vidrios'), porPlantilla)).toMatchObject({ paradas: 1, minutos: 7 })
  })

  it('horas de la jornada', () => {
    expect(minutosJornada('07:00:00', '15:00:00')).toBe(480)
    expect(minutosJornada('22:00', '06:00')).toBe(480)
    expect(horaMas('07:00:00', 75)).toBe('08:15')
    expect(horaMas('23:30', 45)).toBe('00:15')
    expect(horaMas('n/a', 5)).toBeNull()
  })

  it('formatearMinutos pasa a horas desde 60 y dice «—» si no hay dato', () => {
    expect(formatearMinutos(0)).toBe('—')
    expect(formatearMinutos(45)).toBe('45 min')
    expect(formatearMinutos(120)).toBe('2 h')
    expect(formatearMinutos(105)).toBe('1 h 45 min')
  })

  it('mismoRecorrido compara la foto completa (orden y obligatoriedad incluidos)', () => {
    expect(mismoRecorrido(rec('A1:a,b'), rec('A1:a,b'))).toBe(true)
    expect(mismoRecorrido(rec('A1:a,b'), rec('A1:b,a'))).toBe(false)
    expect(mismoRecorrido(rec('A1:a'), rec('A1:a?'))).toBe(false)
  })
})
