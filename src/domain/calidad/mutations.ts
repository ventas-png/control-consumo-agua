// domain/calidad/mutations.ts — Escrituras de calidad de agua (serv:S24). T7/PR3.
// La lógica de cumplimiento es server-side (no se duplica acá); estas son sólo las
// escrituras de fuentes_agua / registros_calidad + la subida del reporte a Storage.
import { supabase } from '../../lib/supabase'

/** Crea una fuente de agua (payload ya armado/sanitizado por la UI). */
export async function createFuente(payload: Record<string, unknown>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('fuentes_agua').insert([payload])
  return { error: error?.message ?? null }
}

/** Actualiza una fuente de agua por id. */
export async function updateFuente(id: string, payload: Record<string, unknown>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('fuentes_agua').update(payload).eq('id', id)
  return { error: error?.message ?? null }
}

/** Activa/desactiva una fuente de agua. */
export async function setFuenteActiva(id: string, activa: boolean): Promise<{ error: string | null }> {
  const { error } = await supabase.from('fuentes_agua').update({ activo: activa }).eq('id', id)
  return { error: error?.message ?? null }
}

/** Registra un análisis de calidad (registro ya armado por la UI). */
export async function createRegistroCalidad(registro: Record<string, unknown>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('registros_calidad').insert([registro])
  return { error: error?.message ?? null }
}

/** Sube el archivo de reporte de calidad al Storage privado (no sobrescribe). */
export async function uploadReporteCalidad(path: string, file: File): Promise<{ error: string | null }> {
  const { error } = await supabase.storage.from('calidad-reportes').upload(path, file, { upsert: false })
  return { error: error?.message ?? null }
}
