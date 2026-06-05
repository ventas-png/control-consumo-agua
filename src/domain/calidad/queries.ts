// domain/calidad/queries.ts — Lecturas de calidad de agua (serv:S24). T7/PR3:
// el acceso directo a Supabase (DB + Storage) sale de CalidadSection.
import { supabase } from '../../lib/supabase'
import type { FuenteAgua, RegistroCalidad } from '../../types'

/** Fuentes de agua del tenant (RLS por empresa), más recientes primero. */
export async function fetchFuentes(): Promise<FuenteAgua[]> {
  const { data } = await supabase
    .from('fuentes_agua')
    .select('*')
    .order('created_at', { ascending: false })
  return (data ?? []) as FuenteAgua[]
}

/** Registros de calidad con la fuente embebida, más recientes primero. */
export async function fetchRegistrosCalidad(): Promise<RegistroCalidad[]> {
  const { data } = await supabase
    .from('registros_calidad')
    .select('*, fuentes_agua(identificador, nombre, tipo_agua)')
    .order('fecha', { ascending: false })
  return (data ?? []) as RegistroCalidad[]
}

/** URL firmada (60s) para descargar un reporte de calidad del Storage privado. */
export async function getReporteCalidadSignedUrl(
  path: string,
): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await supabase.storage
    .from('calidad-reportes')
    .createSignedUrl(path, 60)
  return { url: data?.signedUrl ?? null, error: error?.message ?? null }
}
