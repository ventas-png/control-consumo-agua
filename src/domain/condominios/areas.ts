// domain/condominios/areas.ts — reglas puras del catálogo de áreas.
//
// `normalizarNombreArea` es el ESPEJO en cliente de la función SQL
// public.areas_normalizar_nombre (20260904000100): minúsculas, sin espacios ni
// signos, sin acentos. Solo para COMPARAR — el texto capturado nunca se
// reescribe. Mantener ambas implementaciones alineadas: el backfill de la BD y
// la validación de duplicados de la UI deben ver el mismo mundo.
import type { AreaCondominio } from '../../types'

const ACENTOS = 'áàäâãéèëêíìïîóòöôõúùüûñç'
const PLANOS = 'aaaaaeeeeiiiiooooouuuunc'

/** Nombre normalizado para comparación, o null si no queda nada comparable. */
export function normalizarNombreArea(nombre: string | null | undefined): string | null {
  let s = (nombre ?? '').trim().toLowerCase()
  for (let i = 0; i < ACENTOS.length; i++) s = s.split(ACENTOS[i]).join(PLANOS[i])
  s = s.replace(/[^a-z0-9]+/g, '')
  return s === '' ? null : s
}

/**
 * El área del catálogo cuyo nombre normalizado choca con `nombre`, si existe.
 * `excluirId` permite renombrar un área sin chocar consigo misma. La BD no
 * tiene UNIQUE (hay duplicados históricos pendientes de fusionar); esta
 * validación evita crear NUEVOS duplicados desde la UI.
 */
export function areaDuplicada(
  nombre: string,
  areas: AreaCondominio[],
  excluirId?: string,
): AreaCondominio | null {
  const norm = normalizarNombreArea(nombre)
  if (!norm) return null
  return areas.find(a => a.id !== excluirId && normalizarNombreArea(a.nombre) === norm) ?? null
}

/**
 * Nombre a mostrar para una programación de limpieza: el del área vinculada si
 * existe en el catálogo cargado, si no el snapshot histórico (`fallback`).
 */
export function nombreAreaDe(
  areaId: string | null | undefined,
  areas: AreaCondominio[],
  fallback: string,
): string {
  if (!areaId) return fallback
  return areas.find(a => a.id === areaId)?.nombre ?? fallback
}
