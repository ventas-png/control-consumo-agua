// domain/condominios/limpieza.ts — reglas de asignación y ruta diaria de limpieza.
//
// Vive fuera del tab a propósito: son las decisiones del módulo (a quién le toca
// un área, qué entra en la ruta de hoy, cuándo vuelve a tocar) y se prueban sin
// montar React ni Supabase. El tab solo las orquesta contra la BD.
//
// Modelo de asignación, en dos niveles:
//
//   1. `personal_id`  — el área es de esta persona. Gana siempre.
//   2. `turno`+`cargo` — el área la cubre "quien esté de turno": cualquier
//      empleado activo cuyo turno y cargo encajen. NULL en cualquiera de los
//      dos = comodín ("cualquier turno" / "cualquier cargo").
//
// El nivel 2 es lo que evita re-asignar 40 áreas a mano cada vez que cambia una
// persona: se declara el PERFIL que cubre el área y la plantilla decide el resto.
import type {
  ProgramacionLimpieza,
  PersonalCondominio,
  EjecucionLimpieza,
  FrecuenciaLimpieza,
} from '../../types'
import { evidenciaSuficiente } from './evidencia'

/** Días que suma cada frecuencia para calcular la próxima ejecución. */
export const FRECUENCIA_DIAS: Record<FrecuenciaLimpieza, number> = {
  diaria: 1,
  semanal: 7,
  quincenal: 15,
  mensual: 30,
}

/** Suma días a una fecha ISO (YYYY-MM-DD) sin salirse del calendario local. */
export function sumarDias(fechaISO: string, dias: number): string {
  const [y, m, d] = fechaISO.split('-').map(Number)
  // Mediodía local: un DST de ±1 h no puede mover el día resultante.
  const base = new Date(y, m - 1, d, 12, 0, 0)
  base.setDate(base.getDate() + dias)
  const mm = String(base.getMonth() + 1).padStart(2, '0')
  const dd = String(base.getDate()).padStart(2, '0')
  return `${base.getFullYear()}-${mm}-${dd}`
}

/** Fecha en que vuelve a tocar el área después de ejecutarla en `fechaISO`. */
export function proximaEjecucion(fechaISO: string, frecuencia: FrecuenciaLimpieza): string {
  return sumarDias(fechaISO, FRECUENCIA_DIAS[frecuencia] ?? 7)
}

/** Un empleado puede trabajar hoy si no está de baja. */
export function estaDisponible(p: PersonalCondominio): boolean {
  return p.estado === 'activo'
}

/**
 * ¿Le toca a `empleado` el área `prog`?
 *
 * - Con `personal_id`, solo esa persona (aunque su turno/cargo ya no encajen:
 *   la asignación explícita es una decisión del admin, no una coincidencia).
 * - Sin él, encaja quien cumpla turno Y cargo, tratando NULL como comodín.
 */
export function leTocaArea(prog: ProgramacionLimpieza, empleado: PersonalCondominio): boolean {
  if (!prog.activo) return false
  if (prog.personal_id) return prog.personal_id === empleado.id
  if (prog.turno && prog.turno !== empleado.turno) return false
  if (prog.cargo && prog.cargo !== empleado.cargo) return false
  // Un área sin persona, sin turno y sin cargo no es "de todos": es un área que
  // nadie asignó todavía. Aparece en el catálogo, no en la ruta de alguien.
  return Boolean(prog.turno || prog.cargo)
}

/** Áreas que le tocan a un empleado, en el orden en que debe recorrerlas. */
export function areasDeEmpleado(
  programaciones: ProgramacionLimpieza[],
  empleado: PersonalCondominio,
): ProgramacionLimpieza[] {
  return programaciones
    .filter(p => leTocaArea(p, empleado))
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.area.localeCompare(b.area))
}

/** Empleados que hoy podrían cubrir un área (para mostrar a quién le cae). */
export function empleadosDeArea(
  prog: ProgramacionLimpieza,
  personal: PersonalCondominio[],
): PersonalCondominio[] {
  return personal.filter(e => estaDisponible(e) && leTocaArea(prog, e))
}

// `type` y no `interface` a propósito: los helpers de escritura reciben
// `Record<string, unknown>`, y solo los alias de tipo obtienen índice implícito.
/** Fila lista para insertar en `ejecuciones_limpieza`. */
export type NuevaEjecucion = {
  company_id: string
  project_id: string
  programacion_id: string
  personal_id: string
  fecha: string
  turno: string | null
  orden: number
  estado: 'pendiente'
}

/**
 * Ruta del día: las áreas del empleado que aún no tienen ejecución en `fecha`.
 *
 * Se filtra por lo YA existente en vez de confiar solo en el índice único
 * (programacion_id, fecha): sin esto, regenerar la ruta mandaría un insert que
 * la BD rechaza entero, y el admin vería un error donde no pasa nada malo.
 */
export function construirRuta(params: {
  programaciones: ProgramacionLimpieza[]
  empleado: PersonalCondominio
  fecha: string
  ejecucionesDelDia: EjecucionLimpieza[]
  companyId: string
  projectId: string
}): NuevaEjecucion[] {
  const { programaciones, empleado, fecha, ejecucionesDelDia, companyId, projectId } = params
  const yaCreadas = new Set(
    ejecucionesDelDia.filter(e => e.fecha === fecha).map(e => e.programacion_id),
  )
  return areasDeEmpleado(programaciones, empleado)
    .filter(p => !yaCreadas.has(p.id))
    .map((p, i) => ({
      company_id: companyId,
      project_id: projectId,
      programacion_id: p.id,
      personal_id: empleado.id,
      fecha,
      // El turno de la ejecución es el del área si lo declara; si no, el del
      // empleado — así la ruta queda etiquetada aunque el área sea comodín.
      turno: p.turno ?? empleado.turno ?? null,
      orden: p.orden ?? i,
      estado: 'pendiente' as const,
    }))
}

/**
 * ¿Se puede cerrar la ejecución? El área que exige foto no se cierra sin ella:
 * es la razón de ser de la evidencia, y dejarlo a la buena voluntad de la UI
 * significa que el primer atajo la pierde.
 *
 * Delega en `evidenciaSuficiente` (domain/condominios/evidencia.ts), que es el
 * mismo chequeo que usa Tareas de personal: dos implementaciones de esta idea
 * serían dos maneras de discrepar con el trigger que la impone en la base.
 * Limpieza sólo declara `requiere_foto`, así que sólo eso se le exige.
 */
export function puedeCerrar(
  ejec: Pick<EjecucionLimpieza, 'foto_urls'>,
  prog: Pick<ProgramacionLimpieza, 'requiere_foto'> | undefined,
): { ok: true } | { ok: false; motivo: string } {
  const r = evidenciaSuficiente(
    { requiere_foto: prog?.requiere_foto },
    { foto_urls: ejec.foto_urls },
  )
  return r.ok
    ? { ok: true }
    : { ok: false, motivo: 'Esta área requiere al menos una foto para cerrarse.' }
}

/** Resumen de la ruta para las tarjetas de avance del tab. */
export interface AvanceRuta {
  total: number
  completadas: number
  pendientes: number
  novedades: number
  omitidas: number
  /** Porcentaje 0-100 de áreas ya resueltas (completadas + con novedad). */
  porcentaje: number
}

export function avanceRuta(ejecuciones: EjecucionLimpieza[]): AvanceRuta {
  const total = ejecuciones.length
  const completadas = ejecuciones.filter(e => e.estado === 'completada').length
  const novedades = ejecuciones.filter(e => e.estado === 'con_novedad').length
  const omitidas = ejecuciones.filter(e => e.estado === 'omitida').length
  const pendientes = ejecuciones.filter(e => e.estado === 'pendiente').length
  // Las omitidas no cuentan como resueltas: se omiten justamente porque no se
  // hicieron, y sumarlas al avance haría que "omitir todo" marque 100 %.
  const resueltas = completadas + novedades
  return {
    total,
    completadas,
    pendientes,
    novedades,
    omitidas,
    porcentaje: total === 0 ? 0 : Math.round((resueltas / total) * 100),
  }
}
