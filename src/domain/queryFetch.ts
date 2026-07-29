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
import { logger } from '../lib/logger'

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

// ════════════════════════════════════════════════════════════════════════════
// Degradación VISIBLE (auditoría 2026-07-28 · PR-28)
//
// EL PROBLEMA
// 59 sitios de `src/domain/` desestructuraban SOLO `data` de la respuesta de
// Supabase y tiraban el `error`, devolviendo `[]` / `{}` / `null`. El comentario
// de varios lo llama «degrada a []». El efecto real es que una caída de red o una
// DENEGACIÓN DE RLS es indistinguible de «no hay registros»: el usuario ve una
// tabla vacía y se la cree. En un directorio de residentes o en un listado de
// cuotas eso no es un vacío, es información perdida en silencio.
//
// POR QUÉ NO SE CONVIERTEN A `runQuery` (que es lo que proponía el informe)
// Porque cambiaría el contrato y ROMPERÍA a los llamadores. Verificado sitio a
// sitio: NINGUNO de los 59 se consume como `queryFn` de React Query — son
// funciones planas que los componentes usan con `await` directo o como promesas
// flotantes `void fetchX().then(...)` SIN `.catch()`. Hacerlas lanzar produciría
// rechazos no capturados en vez de UI de error: peor que hoy. Además hay tests
// que fijan el contrato actual (`fetchDirectorioResidentes` devuelve `[]` ante
// error).
//
// QUÉ HACE ESTE HELPER
// Separa las dos cosas que el patrón mezclaba: **degradar** (seguir devolviendo
// el valor por defecto, para no romper a nadie) y **callar** (que era el bug).
// El valor por defecto se mantiene; el error deja de ser invisible y va a Sentry
// con el nombre del sitio. No arregla la UX —eso exige mover cada llamador a
// React Query, y es trabajo por call site— pero convierte un fallo mudo en uno
// diagnosticable, y de paso los datos de Sentry dicen CUÁLES fallan de verdad,
// que es lo que hace falta para priorizar ese refactor.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Forma mínima común a `PostgrestError` y `AuthError`. Se tipa estructuralmente
 * en vez de importar ambos porque 2 de los 59 sitios son de `supabase.auth.*`
 * y su error NO es un PostgrestError — con la firma estrecha habrían quedado
 * fuera del barrido, que es justo el tipo de omisión que este PR viene a quitar.
 */
export interface DegradableError {
  message: string
  code?: string
  details?: string
  hint?: string
}

/**
 * Reporta el `error` de una query cuyo resultado se degrada a un valor por
 * defecto. NO lanza: el llamador conserva su contrato intacto.
 *
 * @param scope Identificador del sitio, `'modulo.funcion'` (p. ej.
 *   `'clientes.fetchClienteAccountMap'`). Es lo que se ve en Sentry, así que
 *   debe permitir localizar el código sin adivinar.
 * @returns `true` si hubo error (por si el llamador quiere ramificar).
 */
export function reportDegradedQuery(
  scope: string,
  error: DegradableError | null | undefined,
): boolean {
  if (!error) return false
  logger.error(
    `[domain] ${scope}: la consulta falló y el resultado se degradó a un valor vacío`,
    { scope, code: error.code, details: error.details, hint: error.hint, message: error.message },
    error,
  )
  return true
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
