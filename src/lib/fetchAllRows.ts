// Paginación server-side por chunks para EXPORTAR/consolidar sin truncar
// (auditoría 2026-07-16, D1). Muchos listados traen `.limit(5000)` o —peor—
// nada, quedando a merced del tope silencioso de PostgREST (~1000 filas por
// defecto): el usuario descarga/recibe un reporte al que le faltan filas sin
// ningún aviso. Este helper recorre la consulta en ventanas con `.range()`
// hasta agotarla, con un techo de seguridad anti-runaway.
//
// El caller pasa `fetchChunk(from, to)` devolviendo la MISMA consulta acotada a
// ese rango (con un `.order()` ESTABLE — sin orden total, `.range()` puede
// saltar o duplicar filas entre ventanas). El helper no conoce Supabase: se
// testea con un fetchChunk falso.

export const CHUNK_SIZE = 1000
// Techo defensivo: un export legítimo rara vez supera esto; si se alcanza,
// devolvemos `truncated: true` para que la UI avise en vez de mentir.
export const HARD_CEILING = 100_000

export interface ChunkResult<T> {
  data: T[] | null
  error: { message: string } | null
}

export interface FetchAllResult<T> {
  data: T[]
  error: string | null
  /** true si se cortó por el techo de seguridad (el resultado NO está completo). */
  truncated: boolean
}

/**
 * Trae TODAS las filas de una consulta paginando con `.range()`. Se detiene
 * cuando un chunk vuelve incompleto (última página) o al alcanzar el techo.
 * Ante error, devuelve lo acumulado hasta ese punto junto al mensaje.
 */
export async function fetchAllRows<T>(
  fetchChunk: (from: number, to: number) => PromiseLike<ChunkResult<T>>,
  opts: { chunkSize?: number; ceiling?: number } = {},
): Promise<FetchAllResult<T>> {
  const chunk = Math.max(1, Math.floor(opts.chunkSize ?? CHUNK_SIZE))
  const ceiling = opts.ceiling ?? HARD_CEILING
  const all: T[] = []
  let from = 0

  for (;;) {
    const to = from + chunk - 1
    const { data, error } = await fetchChunk(from, to)
    if (error) return { data: all, error: error.message, truncated: false }
    const rows = data ?? []
    all.push(...rows)
    // Página incompleta ⇒ era la última: terminamos con el set completo.
    if (rows.length < chunk) return { data: all, error: null, truncated: false }
    // Techo de seguridad: cortamos y avisamos que quedó truncado.
    if (all.length >= ceiling) return { data: all, error: null, truncated: true }
    from += chunk
  }
}
