// Reglas del calendario de limpieza (20261103000000), sin React: qué turno se
// programa, qué rutina se quita, cuánto suma lo asignado contra el turno y los
// indicadores del tab.
import { describe, it, expect } from 'vitest'
import type { PlantillaTareaCargo, RutinaActividad, RutinaArea, RutinaLimpieza, TurnoCalendarioLimpieza } from '../../../types'
import {
  avisoAsignacion, cargaDelTurno, duracionPorRutina, kpisLimpieza, motivoNoProgramable,
  porEmpleado, rutinaQuitable, turnoProgramable,
} from '../calendarioLimpieza'

const HOY = '2026-10-21'

function turno(over: Partial<TurnoCalendarioLimpieza> = {}): TurnoCalendarioLimpieza {
  return {
    bloque_id: 'b1', personal_id: 'p1', personal_nombre: 'Ana', personal_cargo: 'conserje',
    personal_estado: 'activo', fecha: HOY, turno: 'manana', estado: 'pendiente',
    iniciado_en: null, cerrado_en: null, plantilla_horario_id: 'h1', jornada_nombre: 'Mañana',
    jornada_codigo: 'MA', jornada_color: null, hora_inicio: '07:00:00', hora_fin: '15:00:00',
    horas_planificadas: null, rutinas: [], otras_tareas: 0, ...over,
  }
}
const r = (rutina_id: string, tareas = 2, pendientes = 2, hechas = 0, trabajadas = 0) =>
  ({ rutina_id, tareas, pendientes, hechas, trabajadas })

describe('porEmpleado', () => {
  it('agrupa por persona y fecha, en orden de nombre, sin bajas ni turnos cancelados', () => {
    const es = porEmpleado([
      turno({ bloque_id: '1', personal_id: 'p2', personal_nombre: 'Zoe', fecha: '2026-10-22' }),
      turno({ bloque_id: '2', fecha: '2026-10-22', rutinas: [r('x')] }),
      turno({ bloque_id: '3', fecha: '2026-10-22' }),                     // segundo turno el mismo día
      turno({ bloque_id: '4', fecha: '2026-10-23', estado: 'cancelado' }),
      turno({ bloque_id: '5', personal_id: 'p3', personal_nombre: 'Baja', personal_estado: 'inactivo' }),
    ])
    expect(es.map(e => e.nombre)).toEqual(['Ana', 'Zoe'])
    expect(es[0].turnos.get('2026-10-22')?.map(t => t.bloque_id)).toEqual(['2', '3'])
    expect(es[0].turnos.has('2026-10-23')).toBe(false)
    expect([es[0].total, es[0].conRutina]).toEqual([2, 1])
  })
})

describe('qué se programa y qué se quita', () => {
  it('un turno abierto de hoy en adelante, sí; cerrado o pasado, no, y se dice por qué', () => {
    expect(turnoProgramable(turno(), HOY)).toBe(true)
    expect(turnoProgramable(turno({ fecha: '2026-10-20' }), HOY)).toBe(false)
    expect(turnoProgramable(turno({ cerrado_en: '2026-10-21T20:00:00Z' }), HOY)).toBe(false)
    expect(turnoProgramable(turno({ estado: 'completado' }), HOY)).toBe(false)
    expect(turnoProgramable(turno({ estado: 'en_curso' }), HOY)).toBe(true)
    expect(motivoNoProgramable(turno({ fecha: '2026-10-20' }), HOY)).toMatch(/día pasado/)
    expect(motivoNoProgramable(turno({ estado: 'cancelado' }), HOY)).toMatch(/cerrado/)
    expect(motivoNoProgramable(turno(), HOY)).toBeNull()
  })

  it('una rutina se quita mientras nada suyo se haya trabajado', () => {
    expect(rutinaQuitable(turno(), r('x'), HOY)).toBe(true)
    expect(rutinaQuitable(turno(), r('x', 2, 1, 1, 1), HOY)).toBe(false)
    expect(rutinaQuitable(turno({ fecha: '2026-10-20' }), r('x'), HOY)).toBe(false)
  })
})

describe('tiempo asignado contra el turno', () => {
  const plantillas = [
    { id: 'barrer', duracion_estimada_min: 30 },
    { id: 'vidrios', duracion_estimada_min: null },
  ] as PlantillaTareaCargo[]
  const rutinas = [{ id: 'r1' }, { id: 'r2' }] as RutinaLimpieza[]
  const paradas = [
    { id: 'z1', rutina_id: 'r1', area_id: 'a1', orden: 0, created_at: '' },
    { id: 'z2', rutina_id: 'r1', area_id: 'a2', orden: 1, created_at: '' },
  ] as RutinaArea[]
  const pasos = [
    { id: 's1', rutina_id: 'r1', rutina_area_id: 'z1', plantilla_tarea_id: 'barrer', orden: 0, obligatoria: true, created_at: '' },
    { id: 's2', rutina_id: 'r1', rutina_area_id: 'z2', plantilla_tarea_id: 'barrer', orden: 0, obligatoria: true, created_at: '' },
    { id: 's3', rutina_id: 'r1', rutina_area_id: 'z2', plantilla_tarea_id: 'vidrios', orden: 1, obligatoria: true, created_at: '' },
    { id: 's4', rutina_id: 'r2', rutina_area_id: null, plantilla_tarea_id: 'barrer', orden: 0, obligatoria: true, created_at: '' },
  ] as RutinaActividad[]
  const duraciones = duracionPorRutina(rutinas, pasos, paradas, plantillas)

  it('cada rutina suma lo que declara su recorrido, y cuenta lo que no declara duración', () => {
    expect(duraciones.get('r1')).toEqual({ minutos: 60, sinDato: 1, paradas: 2 })
    expect(duraciones.get('r2')).toEqual({ minutos: 30, sinDato: 0, paradas: 0 })
  })

  it('contra las horas planificadas del turno o, sin ellas, contra su horario', () => {
    const t = turno({ rutinas: [r('r1'), r('r2')] })
    expect(cargaDelTurno(t, duraciones)).toEqual({ minutos: 90, sinDato: 1, capacidad: 480, excede: false })
    expect(cargaDelTurno({ ...t, horas_planificadas: 1.25 }, duraciones)).toMatchObject({ capacidad: 75, excede: true })
    expect(cargaDelTurno({ ...t, hora_inicio: null, hora_fin: null }, duraciones).capacidad).toBeNull()
  })
})

describe('indicadores', () => {
  it('atrasadas de la ventana, lo de hoy y los turnos de hoy sin rutina (sin bajas ni cancelados)', () => {
    const k = kpisLimpieza([
      turno({ fecha: '2026-10-19', rutinas: [r('a', 3, 2, 1)] }),
      turno({ fecha: '2026-10-10', rutinas: [r('a', 3, 3, 0)] }),     // fuera de la ventana
      turno({ rutinas: [r('a', 4, 1, 3), r('b', 2, 2, 0)] }),
      // p2 hace rutinas (ayer tuvo una) y hoy no tiene: cuenta.
      turno({ personal_id: 'p2', fecha: '2026-10-20', rutinas: [r('a', 1, 0, 1)] }),
      turno({ personal_id: 'p2' }),
      // p5 nunca tiene rutinas (p. ej. seguridad): su turno de hoy no es «sin rutina».
      turno({ personal_id: 'p5' }),
      turno({ personal_id: 'p3', personal_estado: 'inactivo', rutinas: [] }),
      turno({ personal_id: 'p4', estado: 'cancelado' }),
    ], HOY, '2026-10-14')
    expect(k).toEqual({ atrasadas: 2, pendientesHoy: 3, totalHoy: 6, hechasHoy: 3, turnosHoySinRutina: 1 })
  })
})

describe('avisoAsignacion', () => {
  it('dice qué entró y qué ya estaba', () => {
    expect(avisoAsignacion({ generadas: 4, omitidas_existente: 0 }, 'Ana el mié 21 oct')).toBe('4 tareas asignadas a Ana el mié 21 oct.')
    expect(avisoAsignacion({ generadas: 1, omitidas_existente: 2 }, 'Ana')).toBe('1 tarea asignada a Ana · 2 ya estaban en el turno.')
    expect(avisoAsignacion({ generadas: 0, omitidas_existente: 3 }, 'Ana')).toMatch(/Nada nuevo en Ana/)
  })
})
