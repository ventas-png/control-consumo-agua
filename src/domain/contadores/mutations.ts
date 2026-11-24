// domain/contadores/mutations.ts — Escrituras de contadores. T7/PR3.
// (La creación pasa por validatedInsert con Zod; acá van update/toggle/delete.)
import { supabase } from '../../lib/supabase'
import type { Contador } from '../../types'

/** Actualiza un contador por id (payload ya armado por la UI). Devuelve la fila. */
export async function updateContador(
  id: string,
  payload: Record<string, unknown>,
): Promise<{ data: Contador | null; error: string | null }> {
  const { data, error } = await supabase
    .from('contadores')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  return { data: (data as Contador) ?? null, error: error?.message ?? null }
}

/** Activa/desactiva un contador (sella updated_at). */
export async function setContadorActivo(id: string, activo: boolean): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('contadores')
    .update({ activo, updated_at: new Date().toISOString() })
    .eq('id', id)
  return { error: error?.message ?? null }
}

/** Elimina un contador por id. */
export async function deleteContador(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('contadores').delete().eq('id', id)
  return { error: error?.message ?? null }
}

/**
 * Asigna la misma tarifa a varios contadores. Va por lotes para no exceder el
 * largo de la URL; devuelve los ids que la base realmente actualizó (la RLS
 * puede dejar fuera filas sin avisar) y el error del lote que haya fallado.
 */
export async function asignarTarifaMasiva(
  ids: string[],
  tarifaId: string,
  auditoria: { updated_by: string | null; updated_by_name: string | null },
): Promise<{ actualizados: string[]; error: string | null }> {
  const LOTE = 200
  const actualizados: string[] = []
  const updated_at = new Date().toISOString()
  for (let i = 0; i < ids.length; i += LOTE) {
    const { data, error } = await supabase
      .from('contadores')
      .update({ tarifa_id: tarifaId, updated_at, ...auditoria })
      .in('id', ids.slice(i, i + LOTE))
      .select('id')
    if (error) return { actualizados, error: error.message }
    actualizados.push(...((data ?? []) as { id: string }[]).map(r => r.id))
  }
  return { actualizados, error: null }
}
