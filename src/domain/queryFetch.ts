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
import { fetchAllRows } from '../lib/fetchAllRows'

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

/**
 * Variante para LISTADOS COMPLETOS (Fase 6): trae todas las filas paginando
 * server-side por chunks (lib/fetchAllRows) en vez de un .limit(N) que trunca
 * en silencio — los caps de 5000 rompían totales/exports en tenants grandes.
 *
 * `buildChunk` DEBE encadenar un orden TOTAL (p.ej. .order(col).order('id'))
 * — sin él, range() puede saltar o duplicar filas entre ventanas. Cada chunk
 * corre con su propio timeout (por eso el cap de 5000 "para no exceder el
 * statement_timeout" deja de ser necesario: ninguna ventana es grande).
 *
 * Lanza QueryError en error (mismo contrato que runQuery). Si se alcanza el
 * techo de seguridad de fetchAllRows (100k), avisa por consola y devuelve lo
 * acumulado — preferible a colgar la vista, y el caso es extremo.
 */
export async function runQueryAll<T>(
  buildChunk: (from: number, to: number, signal: AbortSignal) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  timeoutMsPerChunk: number = DEFAULT_TIMEOUT_MS,
): Promise<T[]> {
  const { data, error, truncated } = await fetchAllRows<T>((from, to) =>
    buildChunk(from, to, AbortSignal.timeout(timeoutMsPerChunk)),
  )
  if (error) throw new QueryError(error)
  if (truncated) {
    console.warn(`[runQueryAll] listado cortado en el techo de seguridad (${data.length} filas) — resultado incompleto`)
  }
  return data
}
