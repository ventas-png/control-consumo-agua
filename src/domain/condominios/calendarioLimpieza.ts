// domain/condominios/calendarioLimpieza.ts — el CALENDARIO de limpieza
// (20261103000000): cada empleado con sus turnos del mes y, sobre cada turno, las
// rutinas que le tocan ese día.
//
// Vive fuera de la vista a propósito: qué turno se puede programar, qué rutina
// se puede quitar, cuánto suma lo asignado contra las horas del turno y los
// indicadores del tab son reglas que se prueban sin montar React. La base las
// vuelve a exigir todas (limpieza_asignar_rutinas / limpieza_quitar_rutina);
// aquí deciden qué OFRECER, para no mostrar un ＋ o un ✕ que después se rechaza.
import type {
  PlantillaTareaCargo, ResultadoAsignarRutinas, RutinaActividad, RutinaArea,
  RutinaEnTurno, RutinaLimpieza, TurnoCalendarioLimpieza,
} from '../../types'
import { minutosJornada, recorridoDesdeFilas, tiempoRecorrido } from './rutinasRecorrido'

export interface EmpleadoCalendario {
  personal_id: string
  nombre: string
  cargo: string | null
  /** Turnos por fecha ISO. Casi siempre uno; la base admite varios el mismo día. */
  turnos: Map<string, TurnoCalendarioLimpieza[]>
  /** Turnos del rango, y cuántos ya tienen alguna rutina. */
  total: number
  conRutina: number
}

/**
 * Agrupa los turnos por persona, en orden de nombre. Deja fuera al personal
 * dado de baja (`inactivo`, el mismo criterio que «Asignación turnos») y los
 * turnos cancelados: ninguno de los dos recibe trabajo.
 */
export function porEmpleado(turnos: TurnoCalendarioLimpieza[]): EmpleadoCalendario[] {
  const mapa = new Map<string, EmpleadoCalendario>()
  for (const t of turnos) {
    if (t.personal_estado === 'inactivo' || t.estado === 'cancelado') continue
    let e = mapa.get(t.personal_id)
    if (!e) {
      e = { personal_id: t.personal_id, nombre: t.personal_nombre, cargo: t.personal_cargo, turnos: new Map(), total: 0, conRutina: 0 }
      mapa.set(t.personal_id, e)
    }
    const delDia = e.turnos.get(t.fecha) ?? []
    delDia.push(t)
    e.turnos.set(t.fecha, delDia)
    e.total++
    if (t.rutinas.length > 0) e.conRutina++
  }
  return [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre) || a.personal_id.localeCompare(b.personal_id))
}

/** ¿Se le puede asignar o quitar trabajo? Abierto y de hoy en adelante. */
export function turnoProgramable(t: TurnoCalendarioLimpieza, hoy: string): boolean {
  return !t.cerrado_en
    && t.estado !== 'completado'
    && t.estado !== 'incompleto'
    && t.estado !== 'cancelado'
    && t.fecha >= hoy
}

/** Por qué un turno no se programa, en palabras de quien lo mira. null = sí se puede. */
export function motivoNoProgramable(t: TurnoCalendarioLimpieza, hoy: string): string | null {
  if (t.cerrado_en || t.estado === 'completado' || t.estado === 'incompleto' || t.estado === 'cancelado') {
    return 'El turno ya está cerrado.'
  }
  if (t.fecha < hoy) return 'Es un día pasado: el calendario programa de hoy en adelante.'
  return null
}

/** ¿Se puede quitar esta rutina del turno? Mientras nada suyo se haya trabajado. */
export function rutinaQuitable(t: TurnoCalendarioLimpieza, r: RutinaEnTurno, hoy: string): boolean {
  return turnoProgramable(t, hoy) && r.trabajadas === 0
}

export interface DuracionRutina {
  /** Lo que suman las actividades que declaran duración. */
  minutos: number
  /** Actividades sin duración: sin este número el total miente por defecto. */
  sinDato: number
  /** Áreas del recorrido (sin el grupo legado). */
  paradas: number
}

/**
 * Lo que declara HOY el recorrido de cada rutina. Es una estimación: si la
 * rutina se editó después de asignarla, las tareas del turno son las de aquel
 * momento.
 */
export function duracionPorRutina(
  rutinas: RutinaLimpieza[],
  pasos: RutinaActividad[],
  paradas: RutinaArea[],
  plantillas: PlantillaTareaCargo[],
): Map<string, DuracionRutina> {
  const porPlantilla = new Map(plantillas.map(p => [p.id, p]))
  return new Map(rutinas.map(r => {
    const t = tiempoRecorrido(recorridoDesdeFilas(r.id, paradas, pasos), porPlantilla)
    return [r.id, { minutos: t.minutos, sinDato: t.sinDato, paradas: t.paradas }]
  }))
}

export interface CargaTurno {
  minutos: number
  sinDato: number
  /** Minutos del turno: sus horas planificadas o, sin ellas, su horario. null = no se sabe. */
  capacidad: number | null
  excede: boolean
}

/** Lo asignado a un turno contra lo que dura el turno. */
export function cargaDelTurno(t: TurnoCalendarioLimpieza, duraciones: Map<string, DuracionRutina>): CargaTurno {
  let minutos = 0
  let sinDato = 0
  for (const r of t.rutinas) {
    const d = duraciones.get(r.rutina_id)
    if (!d) continue
    minutos += d.minutos
    sinDato += d.sinDato
  }
  const capacidad = t.horas_planificadas != null && t.horas_planificadas > 0
    ? Math.round(t.horas_planificadas * 60)
    : t.hora_inicio && t.hora_fin ? minutosJornada(t.hora_inicio, t.hora_fin) || null : null
  return { minutos, sinDato, capacidad, excede: capacidad != null && minutos > capacidad }
}

export interface KpisLimpieza {
  /** Tareas de rutina que quedaron pendientes en días anteriores (desde `desdeAtraso`). */
  atrasadas: number
  pendientesHoy: number
  totalHoy: number
  hechasHoy: number
  /**
   * Turnos de hoy sin ninguna rutina, de quienes SÍ hacen rutinas (tuvieron
   * alguna en la ventana). Sin ese filtro el número contaría todos los días los
   * turnos de seguridad o mantenimiento, que no reciben rutinas de limpieza.
   */
  turnosHoySinRutina: number
}

/** Los indicadores del tab, sobre los turnos de [desdeAtraso, hoy]. */
export function kpisLimpieza(turnos: TurnoCalendarioLimpieza[], hoy: string, desdeAtraso: string): KpisLimpieza {
  const k: KpisLimpieza = { atrasadas: 0, pendientesHoy: 0, totalHoy: 0, hechasHoy: 0, turnosHoySinRutina: 0 }
  const hacenRutinas = new Set(turnos.filter(t => t.rutinas.length > 0).map(t => t.personal_id))
  for (const t of turnos) {
    if (t.estado === 'cancelado' || t.personal_estado === 'inactivo') continue
    if (t.fecha < hoy && t.fecha >= desdeAtraso) {
      k.atrasadas += t.rutinas.reduce((s, r) => s + r.pendientes, 0)
    } else if (t.fecha === hoy) {
      k.totalHoy += t.rutinas.reduce((s, r) => s + r.tareas, 0)
      k.pendientesHoy += t.rutinas.reduce((s, r) => s + r.pendientes, 0)
      k.hechasHoy += t.rutinas.reduce((s, r) => s + r.hechas, 0)
      if (t.rutinas.length === 0 && hacenRutinas.has(t.personal_id)) k.turnosHoySinRutina++
    }
  }
  return k
}

/** El aviso tras asignar: qué entró y qué ya estaba. */
export function avisoAsignacion(res: ResultadoAsignarRutinas, destino: string): string {
  if (res.generadas === 0) {
    return res.omitidas_existente > 0
      ? `Nada nuevo en ${destino}: esas tareas ya estaban en el turno.`
      : `Nada que agregar en ${destino}.`
  }
  const base = `${res.generadas} tarea${res.generadas !== 1 ? 's' : ''} asignada${res.generadas !== 1 ? 's' : ''} a ${destino}`
  return res.omitidas_existente > 0
    ? `${base} · ${res.omitidas_existente} ya estaba${res.omitidas_existente !== 1 ? 'n' : ''} en el turno.`
    : `${base}.`
}
