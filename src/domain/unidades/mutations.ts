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

/**
 * Traduce el rechazo del FK a algo accionable.
 *
 * `paquetes_recibidos.unidad_id` es RESTRICT desde 20260901000000: una unidad
 * con historial de recepción NO se borra, porque su constancia de entrega —una
 * notificación legal incluida— tiene que sobrevivir a la baja de la unidad. El
 * mensaje crudo de Postgres ("violates foreign key constraint … on table
 * paquetes_recibidos") no le dice a la administradora ni qué pasó ni qué hacer.
 */
export function mensajeBorradoUnidad(error: { code?: string; message: string } | null): string | null {
  if (!error) return null
  const esFk = error.code === '23503' || /foreign key constraint/i.test(error.message)
  if (esFk && /paquetes_recibidos/i.test(error.message)) {
    return 'Esta unidad tiene historial de recepción (paquetes o correspondencia) y por eso no se puede borrar: '
      + 'la constancia de entrega debe conservarse. Desactívala para retirarla de la operación.'
  }
  if (esFk) {
    return 'Esta unidad tiene registros asociados y no se puede borrar. Desactívala para retirarla de la operación.'
  }
  return error.message
}

/**
 * Elimina una unidad por id. Falla a propósito si tiene historial de recepción
 * (ver `mensajeBorradoUnidad`); la operación recomendada en ese caso es
 * `setUnidadActiva(id, false)`.
 */
export async function deleteUnidad(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('unidades').delete().eq('id', id)
  return { error: mensajeBorradoUnidad(error) }
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
