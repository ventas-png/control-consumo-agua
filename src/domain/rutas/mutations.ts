// domain/rutas/mutations.ts — Escrituras de rutas (agua/condominios). T7/PR3: el
// acceso directo a la tabla `rutas` sale de RutasSection hacia la capa domain.
import { hoyLocalISO } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { Ruta } from '../../types'

type RutaWriteResult = { data: Ruta | null; error: string | null }

/** Crea una ruta (payload ya armado por la UI). Devuelve la fila creada. */
export async function createRuta(payload: Record<string, unknown>): Promise<RutaWriteResult> {
  const { data, error } = await supabase.from('rutas').insert(payload).select()
  return { data: (data?.[0] as Ruta) ?? null, error: error?.message ?? null }
}

/** Actualiza una ruta por id (payload ya armado por la UI). Devuelve la fila. */
export async function updateRuta(id: string, payload: Record<string, unknown>): Promise<RutaWriteResult> {
  const { data, error } = await supabase.from('rutas').update(payload).eq('id', id).select()
  return { data: (data?.[0] as Ruta) ?? null, error: error?.message ?? null }
}

/** Elimina una ruta por id. */
export async function deleteRuta(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('rutas').delete().eq('id', id)
  return { error: error?.message ?? null }
}

/** Marca una ruta (no recurrente) como completada. */
export async function markRutaCompletada(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('rutas').update({ completada: true }).eq('id', id)
  return { error: error?.message ?? null }
}

/**
 * Marca como completada la ocurrencia relevante de una ruta RECURRENTE: la
 * pendiente/vencida más reciente con fecha <= hoy (zona GT), o si no hay, la
 * próxima pendiente. No-op si no hay ninguna. (Lógica movida de LecturasSection.)
 */
export async function completeRelevantOcurrencia(rutaId: string): Promise<void> {
  // PR-29: antes `new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10)`,
  // es decir un offset de −6 h CODIFICADO A MANO para fingir la hora de Guatemala.
  // Falla para cualquier tenant fuera de GMT-6 —el producto ya factura en varias
  // monedas LATAM (20260612203000_companies_currency_latam)— y en los cambios de
  // horario. `hoyLocalISO()` usa la zona real del navegador.
  const hoyLocal = hoyLocalISO()
  const enRango = await supabase
    .from('ruta_ocurrencias')
    .select('id')
    .eq('ruta_id', rutaId)
    .in('estado', ['pendiente', 'vencida'])
    .lte('fecha', hoyLocal)
    .order('fecha', { ascending: false })
    .limit(1)
  let occId = enRango.data?.[0]?.id as string | undefined
  if (!occId) {
    const proxima = await supabase
      .from('ruta_ocurrencias')
      .select('id')
      .eq('ruta_id', rutaId)
      .in('estado', ['pendiente', 'vencida'])
      .gte('fecha', hoyLocal)
      .order('fecha', { ascending: true })
      .limit(1)
    occId = proxima.data?.[0]?.id as string | undefined
  }
  if (occId) {
    await supabase
      .from('ruta_ocurrencias')
      .update({ estado: 'completada', completada_at: new Date().toISOString() })
      .eq('id', occId)
  }
}
