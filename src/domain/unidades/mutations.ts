// domain/unidades/mutations.ts — Escrituras del módulo unidades. T7/PR3.
import { supabase } from '../../lib/supabase'
import type { Unidad } from '../../types'

type UnidadWriteResult = { data: Unidad | null; error: string | null }

/** Crea una unidad (payload ya armado por la UI, con project_id/company_id). */
export async function createUnidad(payload: Record<string, unknown>): Promise<UnidadWriteResult> {
  const { data, error } = await supabase.from('unidades').insert(payload).select().single()
  return { data: (data as Unidad) ?? null, error: error?.message ?? null }
}

/** Inserta unidades en lote (import). Devuelve las filas creadas. */
export async function insertUnidades(
  rows: Record<string, unknown>[],
): Promise<{ data: Unidad[] | null; error: string | null }> {
  const { data, error } = await supabase.from('unidades').insert(rows).select()
  return { data: (data as Unidad[]) ?? null, error: error?.message ?? null }
}

/** Actualiza una unidad por id (payload ya armado por la UI). Devuelve la fila. */
export async function updateUnidad(id: string, payload: Record<string, unknown>): Promise<UnidadWriteResult> {
  const { data, error } = await supabase.from('unidades').update(payload).eq('id', id).select().single()
  return { data: (data as Unidad) ?? null, error: error?.message ?? null }
}

/** Activa/desactiva una unidad (sella updated_at). */
export async function setUnidadActiva(id: string, activo: boolean): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('unidades')
    .update({ activo, updated_at: new Date().toISOString() })
    .eq('id', id)
  return { error: error?.message ?? null }
}

/** Elimina una unidad por id (sus contadores quedan con unidad_id null por FK). */
export async function deleteUnidad(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('unidades').delete().eq('id', id)
  return { error: error?.message ?? null }
}

/** Asigna un conjunto de contadores a una unidad. */
export async function assignContadoresToUnidad(unidadId: string, contadorIds: string[]): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('contadores')
    .update({ unidad_id: unidadId, updated_at: new Date().toISOString() })
    .in('id', contadorIds)
  return { error: error?.message ?? null }
}

/** Desvincula un conjunto de contadores (unidad_id → null). */
export async function unlinkContadores(contadorIds: string[]): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('contadores')
    .update({ unidad_id: null, updated_at: new Date().toISOString() })
    .in('id', contadorIds)
  return { error: error?.message ?? null }
}
