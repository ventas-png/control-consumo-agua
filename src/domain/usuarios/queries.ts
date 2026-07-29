// domain/usuarios/queries.ts — Lecturas de app_users compartidas por varios
// módulos (rutas, contadores, unidades…). T7/PR3.
import { reportDegradedQuery } from '../queryFetch'
import { supabase } from '../../lib/supabase'

/** Forma mínima de un usuario de plataforma para selectores de asignación. */
export interface AppUser {
  id: string
  full_name: string
  role: string
  activo: boolean
}

/**
 * Usuarios activos del tenant (la RLS de app_users ya acota por empresa). Para
 * dropdowns de asignación (rutas, etc.). Degrada a `[]` si no hay datos.
 */
export async function fetchActiveAppUsers(): Promise<AppUser[]> {
  const { data, error } = await supabase
    .from('app_users')
    .select('id, full_name, role, activo')
    .eq('activo', true)
  reportDegradedQuery('usuarios.fetchActiveAppUsers', error)
  return (data as AppUser[] | null) ?? []
}

/** Nombre (id + full_name) de un conjunto de usuarios por id. Para el indicador
 * de presencia (resuelve nombres faltantes). Degrada a `[]`. */
export async function fetchAppUserNamesByIds(
  ids: string[],
): Promise<{ id: string; full_name: string }[]> {
  const { data, error } = await supabase.from('app_users').select('id, full_name').in('id', ids)
  reportDegradedQuery('usuarios.fetchAppUserNamesByIds', error)
  return (data as { id: string; full_name: string }[] | null) ?? []
}
