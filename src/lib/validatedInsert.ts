// agua:C6 part 3 / cond:C2 part 3 — Wrapper de Supabase con pre-validación Zod.
//
// Por qué: hoy cada callsite hace
//     const { error } = await supabase.from('clientes').insert(payload)
// y depende de los CHECK constraints en DB para atrapar errores de shape.
// Eso es la última línea de defensa, pero el feedback al usuario llega
// tarde (round trip de red, mensaje genérico de Postgres) y los errores
// de tipos compuestos (e.g. "CAM no necesita unidad_id pero el resto sí")
// no se expresan bien en SQL.
//
// Solución: validar con el schema de Zod del dominio ANTES de mandar el
// insert. Si falla, devolvemos un error con la misma shape que
// `PostgrestError` (`{ code, message, details, hint }`) más un campo
// extra `fieldErrors` para feedback granular en formularios.
//
// Drop-in replacement: el callsite cambia de
//     const { error } = await supabase.from('clientes').insert(payload)
// a
//     const { error } = await validatedInsert('clientes', clienteInputSchema, payload)
//
// El error sigue siendo `error?.message`-compatible para code legacy que
// solo muestra el mensaje. Code nuevo puede hacer narrow por
// `error?.code === 'VALIDATION_FAILED'` para mostrar errores por campo.

import { z } from 'zod'
import type { PostgrestError } from '@supabase/supabase-js'
import { supabase as defaultClient } from './supabase'

export const VALIDATION_FAILED_CODE = 'VALIDATION_FAILED' as const

export interface ValidationError {
  // Mismo shape que PostgrestError para compat con `error?.message` legacy.
  code: typeof VALIDATION_FAILED_CODE
  message: string
  details: string
  hint: string
  // Campos extra para feedback granular en formularios.
  fieldErrors: Record<string, string[]>
  formErrors: string[]
}

export function isValidationError(
  error: unknown,
): error is ValidationError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === VALIDATION_FAILED_CODE
  )
}

type SupabaseClientLike = typeof defaultClient

export interface ValidatedInsertOptions {
  // Cliente Supabase a usar (default: el cliente del módulo `lib/supabase`).
  // Útil para tests o para inyectar un cliente con credenciales distintas.
  client?: SupabaseClientLike
  // Si es `true`, encadena `.select()` para retornar las filas insertadas.
  returning?: boolean
}

export interface ValidatedInsertResult<T = unknown> {
  data: T | null
  error: ValidationError | PostgrestError | null
}

// Construye un ValidationError a partir de una ZodError.
function buildValidationError(zodError: z.ZodError): ValidationError {
  const flat = zodError.flatten()
  const fieldErrors = flat.fieldErrors as Record<string, string[]>
  const formErrors = flat.formErrors
  // Mensaje de "primera línea" para callers legacy: priorizamos errores de
  // formulario completo y caemos al primer error de campo.
  const firstField = Object.entries(fieldErrors).find(([, msgs]) => msgs && msgs.length > 0)
  const message =
    formErrors[0] ??
    (firstField ? `${firstField[0]}: ${firstField[1][0]}` : 'Validación falló')
  return {
    code: VALIDATION_FAILED_CODE,
    message,
    details: JSON.stringify(fieldErrors),
    hint: '',
    fieldErrors,
    formErrors,
  }
}

// Inserta `payload` en `table` después de validarlo con `schema`. Si la
// validación falla, NO toca la DB y devuelve un `ValidationError` con la
// misma shape que `PostgrestError` (compatible con `error?.message`).
// Si la validación pasa, hace `supabase.from(table).insert(<validated>)`
// (opcionalmente con `.select()` si `returning: true`) y propaga el
// `PostgrestError` o `data` resultante.
export async function validatedInsert<TSchema extends z.ZodTypeAny>(
  table: string,
  schema: TSchema,
  payload: unknown,
  options: ValidatedInsertOptions = {},
): Promise<ValidatedInsertResult<z.infer<TSchema>[]>> {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    return { data: null, error: buildValidationError(parsed.error) }
  }
  const client = options.client ?? defaultClient
  // `as any` aquí porque el tipo de Supabase para `.from(table)` es genérico
  // sobre la database schema y no podemos resolverlo sin generated types.
  // El runtime es seguro: `parsed.data` ya pasó el schema de Zod.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = (client.from(table) as any).insert(parsed.data)
  const result = options.returning ? await query.select() : await query
  return {
    data: (result.data ?? null) as z.infer<TSchema>[] | null,
    error: result.error,
  }
}

// Variante para batch insert: valida CADA item del array contra el schema.
// Si cualquier item falla, retorna error sin tocar la DB (atómico). El
// `fieldErrors` de un fallo incluye el índice del item entre brackets,
// e.g. `{ "0.nombre": ["..."] }` para identificar la fila problemática.
export async function validatedInsertMany<TSchema extends z.ZodTypeAny>(
  table: string,
  schema: TSchema,
  payloads: unknown[],
  options: ValidatedInsertOptions = {},
): Promise<ValidatedInsertResult<z.infer<TSchema>[]>> {
  const arraySchema = z.array(schema)
  const parsed = arraySchema.safeParse(payloads)
  if (!parsed.success) {
    return { data: null, error: buildValidationError(parsed.error) }
  }
  const client = options.client ?? defaultClient
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = (client.from(table) as any).insert(parsed.data)
  const result = options.returning ? await query.select() : await query
  return {
    data: (result.data ?? null) as z.infer<TSchema>[] | null,
    error: result.error,
  }
}

// Versión para `update`. Acepta un schema parcial (Partial<input>) — usar
// `schema.partial()` del lado del caller si la entrada no es completa.
export interface ValidatedUpdateOptions extends ValidatedInsertOptions {
  // Filtros de la query update. Aplican como `.eq(col, val)` en orden.
  match: Record<string, string | number | boolean | null>
}

export async function validatedUpdate<TSchema extends z.ZodTypeAny>(
  table: string,
  schema: TSchema,
  payload: unknown,
  options: ValidatedUpdateOptions,
): Promise<ValidatedInsertResult<z.infer<TSchema>[]>> {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    return { data: null, error: buildValidationError(parsed.error) }
  }
  const client = options.client ?? defaultClient
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (client.from(table) as any).update(parsed.data)
  for (const [col, val] of Object.entries(options.match)) {
    query = query.eq(col, val)
  }
  const result = options.returning ? await query.select() : await query
  return {
    data: (result.data ?? null) as z.infer<TSchema>[] | null,
    error: result.error,
  }
}
