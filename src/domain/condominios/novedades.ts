// domain/condominios/novedades.ts — lo que el operativo encontró, venga de donde venga.
//
// EL PROBLEMA QUE RESUELVE.
// Un hallazgo («la llave gotea», «falta luminaria en el pasillo») nace en dos
// motores distintos: la ruta de limpieza (`ejecuciones_limpieza`) y el turno de
// personal (`tareas_bloque`). Son tablas con forma distinta —una cuelga de un
// área programada, la otra de una tarea de turno— pero para quien administra
// son lo mismo: algo que alguien vio y no le tocaba resolver.
//
// Hasta ahora sólo la primera tenía dónde aparecer. `tareas_bloque` ganó
// `novedad`/`prioridad`/`requiere_mantenimiento` en 20260905000100 «para
// paridad», y la paridad quedó a medias: las columnas existían en la base y
// eran inalcanzables desde la pantalla. Dato muerto, el mismo patrón que
// `requiere_foto` arrastró año y medio.
//
// POR QUÉ UN ADAPTADOR Y NO DOS VISTAS.
// Duplicar `VistaNovedades` sería duplicar también el orden por prioridad, los
// filtros y el criterio de qué cuenta como novedad — es decir, crear dos
// maneras de estar en desacuerdo. Normalizando aquí, la vista deja de saber a
// qué tabla escribe y el padre decide; probar el criterio no exige montar React.
import type {
  EjecucionLimpieza, ProgramacionLimpieza, PersonalCondominio,
  BloqueTurno, TareaBloque, PrioridadNovedadLimpieza,
} from '../../types'

export type FuenteNovedad = 'limpieza' | 'tarea'

/** Lo que administrar una novedad necesita, sin rastro de la tabla de origen. */
export interface NovedadOperativa {
  /**
   * Clave de render. Lleva la fuente porque los ids de dos tablas distintas
   * podrían coincidir y React no perdona claves repetidas.
   */
  clave: string
  /** Id de la fila ORIGEN: es lo que `onAtender` necesita para escribir. */
  id: string
  fuente: FuenteNovedad
  /** Dónde ocurrió: el área programada, o el título de la tarea. */
  titulo: string
  icono: string
  /** El hallazgo en sí. Nunca vacío: sin texto ni bandera no hay novedad. */
  texto: string
  prioridad: PrioridadNovedadLimpieza | null
  requiere_mantenimiento: boolean
  fecha: string
  /**
   * Nombre YA resuelto, no el id. Las tres respuestas posibles —el nombre, «Sin
   * asignar» y «Empleado dado de baja»— dicen cosas distintas al administrador,
   * y resolverlas aquí evita que la vista tenga que recibir el padrón.
   */
  persona: string
  foto_urls: string[]
}

/**
 * Orden de lectura: primero lo urgente, y dentro de cada prioridad lo más
 * reciente. Vive aquí y no en la vista para que las dos fuentes ordenen igual
 * — si cada una ordenara por su cuenta, mezclarlas daría un listado arbitrario.
 */
const PESO_PRIORIDAD: Record<string, number> = { alta: 0, media: 1, baja: 2 }

function porPrioridadYFecha(a: NovedadOperativa, b: NovedadOperativa): number {
  return (
    (PESO_PRIORIDAD[a.prioridad ?? 'baja'] ?? 3) - (PESO_PRIORIDAD[b.prioridad ?? 'baja'] ?? 3)
    || b.fecha.localeCompare(a.fecha)
  )
}

/**
 * `tareas_bloque.prioridad` es `text` con CHECK: el tipo de TS dice el dominio,
 * pero el dato llega por la red y el tipo es una afirmación, no una garantía.
 * Filas anteriores al CHECK o escritas por otra ruta caen a null en vez de
 * romper el orden con un peso que no existe.
 */
function prioridadValida(v: string | null | undefined): PrioridadNovedadLimpieza | null {
  return v === 'baja' || v === 'media' || v === 'alta' ? v : null
}

function nombreDe(personal: PersonalCondominio[], id: string | null | undefined): string {
  if (!id) return 'Sin asignar'
  // El empleado puede haber salido de la nómina después de reportar: la novedad
  // sigue siendo válida, y decir «Empleado dado de baja» es más honesto que
  // dejar el hueco en blanco.
  return personal.find(p => p.id === id)?.nombre ?? 'Empleado dado de baja'
}

/** Novedades de la ruta de limpieza. */
export function novedadesDeEjecuciones(
  programaciones: ProgramacionLimpieza[],
  ejecuciones: EjecucionLimpieza[],
  personal: PersonalCondominio[],
): NovedadOperativa[] {
  const areaPorId = new Map(programaciones.map(p => [p.id, p]))

  return ejecuciones
    // Una ejecución anulada es una fila que se declaró equivocada: su novedad no
    // debe seguir pidiendo mantenimiento. `VistaRuta` ya la excluye; la vista de
    // novedades no lo hacía, y el filtro se salda aquí para las dos fuentes.
    .filter(e => !e.anulada_en)
    .filter(e => (e.novedad ?? '').trim() !== '' || e.requiere_mantenimiento)
    .map<NovedadOperativa>(e => ({
      clave: `limpieza:${e.id}`,
      id: e.id,
      fuente: 'limpieza',
      titulo: areaPorId.get(e.programacion_id)?.area ?? 'Área eliminada',
      icono: '🧹',
      texto: (e.novedad ?? '').trim() || 'Se marcó para mantenimiento sin descripción.',
      prioridad: e.prioridad ?? null,
      requiere_mantenimiento: e.requiere_mantenimiento,
      fecha: e.fecha,
      persona: nombreDe(personal, e.personal_id),
      foto_urls: e.foto_urls ?? [],
    }))
    .sort(porPrioridadYFecha)
}

/**
 * Novedades de los turnos de personal.
 *
 * `notas_operativo` es el respaldo de `novedad`: antes de que la captura
 * escribiera las columnas de paridad, cerrar «con observación» guardaba el
 * hallazgo ahí y en ningún otro lado. Leer lo nuevo y caer a lo viejo hace que
 * el histórico aparezca en el listado en vez de quedar invisible, sin reescribir
 * lo que aquellas filas significan.
 */
export function novedadesDeTareas(
  bloques: BloqueTurno[],
  tareas: TareaBloque[],
  personal: PersonalCondominio[],
): NovedadOperativa[] {
  const bloquePorId = new Map(bloques.map(b => [b.id, b]))

  return tareas
    .filter(t => !t.anulada_en)
    .map(t => ({ t, texto: ((t.novedad ?? t.notas_operativo) ?? '').trim() }))
    .filter(({ t, texto }) => texto !== '' || t.requiere_mantenimiento === true)
    .map<NovedadOperativa>(({ t, texto }) => {
      const bloque = bloquePorId.get(t.bloque_id)
      return {
        clave: `tarea:${t.id}`,
        id: t.id,
        fuente: 'tarea',
        titulo: t.titulo,
        icono: '🧰',
        texto: texto || 'Se marcó para mantenimiento sin descripción.',
        prioridad: prioridadValida(t.prioridad),
        requiere_mantenimiento: t.requiere_mantenimiento === true,
        // La tarea no lleva fecha propia: la del turno al que pertenece es la
        // que responde «¿cuándo se vio esto?». Sin bloque —dato incompleto— se
        // usa el día del alta antes que dejar la novedad fuera del orden.
        fecha: bloque?.fecha ?? t.created_at.slice(0, 10),
        persona: nombreDe(personal, bloque?.personal_id),
        foto_urls: t.foto_urls ?? [],
      }
    })
    .sort(porPrioridadYFecha)
}

/**
 * Dónde vive cada fuente. Es lo único que hay que saber para escribir sobre una
 * novedad, y vive junto al tipo para que agregar una tercera fuente sea agregar
 * una línea aquí y no buscar `switch (fuente)` por el código.
 */
export const TABLA_DE_FUENTE: Record<FuenteNovedad, string> = {
  limpieza: 'ejecuciones_limpieza',
  tarea: 'tareas_bloque',
}
