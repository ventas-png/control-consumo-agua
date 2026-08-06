// domain/usuarios/queries.ts — Lecturas de app_users compartidas por varios
// módulos (rutas, contadores, unidades…). T7/PR3.
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportDegradedQuery, runQuery } from '../queryFetch'
import { supabase } from '../../lib/supabase'
import { usuariosKeys } from './keys'

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

/**
 * Directorio COMPLETO del tenant, incluyendo usuarios inactivos.
 *
 * A diferencia de `fetchActiveAppUsers` (que filtra `activo = true` porque
 * alimenta selectores de asignación: no tiene sentido asignarle una ruta a
 * alguien que ya no trabaja aquí), la trazabilidad necesita resolver el nombre
 * de QUIEN HIZO la cosa, y esa persona puede haberse dado de baja hace meses.
 * Filtrar por `activo` aquí haría que las lecturas viejas se mostraran como
 * "usuario desconocido" justo cuando más importa saber quién fue.
 */
export async function fetchDirectorioUsuarios(): Promise<AppUser[]> {
  return (
    (await runQuery<AppUser[]>((signal) =>
      supabase.from('app_users').select('id, full_name, role, activo').abortSignal(signal),
    )) ?? []
  )
}

/**
 * Mapa `id → AppUser` del tenant para resolver las columnas de trazabilidad
 * (`creado_por`, `completado_por`, `registrado_por`…) sin que cada pestaña
 * repita la consulta. Cacheado por react-query: el directorio cambia poco, así
 * que 10 minutos de `staleTime` evitan refetches en cada cambio de pestaña.
 *
 * Lo consume `<UsuarioChip>`; rara vez hace falta usarlo directamente.
 */
export function useUsuariosMap(companyId?: string) {
  const query = useQuery({
    queryKey: usuariosKeys.directorio(companyId),
    queryFn: fetchDirectorioUsuarios,
    staleTime: 10 * 60 * 1000,
  })
  // useMemo: sin él, cada render devolvería un Map nuevo y haría re-renderizar
  // a todos los <UsuarioChip> de la tabla en cada tecla de un filtro.
  const mapa = useMemo(() => {
    const m = new Map<string, AppUser>()
    for (const u of query.data ?? []) m.set(u.id, u)
    return m
  }, [query.data])
  return { mapa, isLoading: query.isLoading }
}
