// domain/condominios/tabMutations.ts — CRUD genérico de las tablas de condominios
// para los tabs del panel admin. T7/PR3.
//
// Los ~146 tabs de condominios/tabs reciben sus datos por props (los carga
// CondominiosSection) y solo ESCRIBEN sobre su tabla de feature con el mismo
// shape: insert(payload) / update(patch).eq('id', id) / delete().eq('id', id).
// Estos helpers genéricos (la tabla es un parámetro; `lib/supabase` no está tipado
// con Database, así que `from(table)` con string es lo idiomático aquí) centralizan
// ese acceso sin un archivo por tabla.
//
// IMPORTANTE: a diferencia del resto de la capa domain (que mapea a `error:string`),
// estos helpers devuelven el ERROR CON SHAPE `{ message }` (el de supabase) para que
// los ~140 tabs que ya hacen `error.message` / `if (error)` migren con un simple
// swap de la llamada, sin tocar su manejo de errores.
import { supabase } from '../../lib/supabase'

/** Error con el shape mínimo que consume la UI (mensaje legible). */
export type RowError = { message: string } | null

/** Inserta una fila (o varias) en `table` (payload ya armado por la UI). */
export async function createCondominioRow(
  table: string,
  payload: Record<string, unknown> | Record<string, unknown>[],
): Promise<{ error: RowError }> {
  const { error } = await supabase.from(table).insert(payload)
  return { error }
}

/** Inserta una fila en `table` y devuelve la fila creada. */
export async function createCondominioRowReturning(
  table: string,
  payload: Record<string, unknown>,
): Promise<{ data: Record<string, unknown> | null; error: RowError }> {
  const { data, error } = await supabase.from(table).insert(payload).select().single()
  return { data: (data as Record<string, unknown>) ?? null, error }
}

/** Upsert de una fila en `table` (resuelve conflictos por `onConflict`). */
export async function upsertCondominioRow(
  table: string,
  payload: Record<string, unknown>,
  onConflict?: string,
): Promise<{ error: RowError }> {
  const { error } = await supabase
    .from(table)
    .upsert(payload, onConflict ? { onConflict } : undefined)
  return { error }
}

/** Actualiza la fila `id` de `table` con `patch`. */
export async function updateCondominioRow(
  table: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<{ error: RowError }> {
  const { error } = await supabase.from(table).update(patch).eq('id', id)
  return { error }
}

/** Elimina la fila `id` de `table`. */
export async function deleteCondominioRow(
  table: string,
  id: string,
): Promise<{ error: RowError }> {
  const { error } = await supabase.from(table).delete().eq('id', id)
  return { error }
}

/** Elimina filas de `table` por una columna distinta de `id` (ej. encuesta_id). */
export async function deleteCondominioRowBy(
  table: string,
  column: string,
  value: string,
): Promise<{ error: RowError }> {
  const { error } = await supabase.from(table).delete().eq(column, value)
  return { error }
}

/**
 * Marca un conjunto de cuotas de condominio como 'moroso' por id (acción de la
 * automatización "marcar_moroso"). Bespoke por el `.in(...)`. Mismo shape de
 * error (`{ message }`) que el resto de helpers de tab.
 */
export async function marcarCuotasMorosas(ids: string[]): Promise<{ error: RowError }> {
  const { error } = await supabase.from('cuotas_condominio').update({ estado: 'moroso' }).in('id', ids)
  return { error }
}
