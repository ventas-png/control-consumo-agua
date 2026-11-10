// Herramienta planificada de una actividad (plantilla_tarea_herramientas): desde
// 20261122000000 el recurso es un EQUIPO (equipos_comunes, `equipo_id`); las filas
// anteriores apuntan a Inventario (`inventario_id`) y siguen vigentes. Estas tres
// funciones puras resuelven cuál de los dos aplica, para que pantallas y cálculo
// (ejecución guiada) no repitan la regla. Sin React ni Supabase: módulo puro.
import type { PlantillaTareaHerramienta } from '../../types'

export type RecursoHerramienta = Pick<PlantillaTareaHerramienta, 'equipo_id' | 'inventario_id'>
  & Partial<Pick<PlantillaTareaHerramienta, 'equipo_nombre' | 'equipo_estado' | 'inventario_nombre' | 'inventario_estado'>>

/** Id del recurso: el equipo (equipos_comunes) o, en las filas legadas, el artículo de Inventario. */
export const herramientaId = (r: RecursoHerramienta): string => r.equipo_id ?? r.inventario_id ?? ''
/** Nombre para la pantalla, venga del embed de Equipos o del de Inventario (legado). */
export const herramientaNombre = (r: RecursoHerramienta): string | undefined => r.equipo_nombre ?? r.inventario_nombre
/** El recurso ya no está vigente: equipo de baja o artículo de inventario dado de baja. */
export const herramientaDeBaja = (r: RecursoHerramienta): boolean =>
  r.equipo_id ? r.equipo_estado === 'baja' : r.inventario_estado === 'dado_de_baja'
