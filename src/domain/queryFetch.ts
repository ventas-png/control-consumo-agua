// T7 — Capa de datos. Helper compartido para ejecutar queries de Supabase
// dentro de TanStack Query.
//
// Hace dos cosas que todas las queries del dominio necesitan:
//   1. Timeout por query (15 s) vía AbortSignal.timeout — espeja el patrón de
//      useData: una query lenta falla en aislamiento en vez de colgar la vista.
//   2. Desempaqueta `{ data, error }` de PostgREST y LANZA en error, para que
//      react-query gestione el estado de error (isError/error) de forma uniforme
//      en lugar de que cada hook reimplemente el chequeo.
//
// Convención de uso en un hook de dominio:
//   queryFn: async () =>
//     (await runQuery<Cliente[]>((signal) =>
//       supabase.from('clientes').select('*').abortSignal(signal))) ?? []
import type { PostgrestError } from '@supabase/supabase-js'

const DEFAULT_TIMEOUT_MS = 15_000

/** Error de una query de dominio. Conserva el PostgrestError original en `cause`. */
export class QueryError extends Error {
  readonly cause?: PostgrestError | null
  constructor(message: string, cause?: PostgrestError | null) {
    super(message)
    this.name = 'QueryError'
    this.cause = cause
  }
}

/**
 * Ejecuta un builder de Supabase con timeout y desempaqueta la respuesta.
 * `build` recibe el AbortSignal y devuelve el thenable de PostgREST.
 * Devuelve `data` tal cual (puede ser null para single-row); los hooks de lista
 * deben aplicar `?? []`.
 */
export async function runQuery<T>(
  build: (signal: AbortSignal) => PromiseLike<{ data: T | null; error: PostgrestError | null }>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T | null> {
  const { data, error } = await build(AbortSignal.timeout(timeoutMs))
  if (error) throw new QueryError(error.message, error)
  return data
}
