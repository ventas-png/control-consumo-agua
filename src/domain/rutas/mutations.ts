// domain/rutas/mutations.ts — Escrituras de rutas (agua/condominios). T7/PR3: el
// acceso directo a la tabla `rutas` sale de RutasSection hacia la capa domain.
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
