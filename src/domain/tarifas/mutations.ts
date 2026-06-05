// domain/tarifas/mutations.ts — Escrituras de tarifas de agua. T7/PR3: el acceso
// directo a la tabla `tarifas` sale de los componentes hacia la capa domain.
import { supabase } from '../../lib/supabase'
import type { Tarifa } from '../../types'

type TarifaWriteResult = { data: Tarifa | null; error: string | null }

/** Crea una tarifa (fila ya armada por la UI, con project_id/company_id). */
export async function createTarifa(fields: Record<string, unknown>): Promise<TarifaWriteResult> {
  const { data, error } = await supabase.from('tarifas').insert(fields).select().single()
  return { data: (data as Tarifa) ?? null, error: error?.message ?? null }
}

/** Actualiza una tarifa por id (set de columnas ya armado por la UI). */
export async function updateTarifa(id: string, fields: Record<string, unknown>): Promise<TarifaWriteResult> {
  const { data, error } = await supabase.from('tarifas').update(fields).eq('id', id).select().single()
  return { data: (data as Tarifa) ?? null, error: error?.message ?? null }
}

/** Activa/desactiva una tarifa (sella updated_at). */
export async function setTarifaActiva(id: string, activa: boolean): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('tarifas')
    .update({ activa, updated_at: new Date().toISOString() })
    .eq('id', id)
  return { error: error?.message ?? null }
}

/**
 * Elimina una tarifa por id. Devuelve `{ error }` con el mensaje legible (o `null`
 * en éxito) para que la UI muestre el aviso sin tocar `supabase`.
 */
export async function deleteTarifa(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('tarifas').delete().eq('id', id)
  return { error: error?.message ?? null }
}
