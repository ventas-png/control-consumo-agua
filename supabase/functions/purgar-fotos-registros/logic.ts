// Lógica de la purga de fotos, extraída del handler para poder probarla en
// aislamiento (mismo patrón que sync-stripe-quantities/logic.ts): sin Deno y
// sin supabase-js, contra una interfaz mínima del cliente → corre en vitest.
//
// POR QUÉ ES GENÉRICA. La función nació purgando una sola cosa (las fotos de
// lectura de agua). Ahora purga dos, y las dos tienen exactamente la misma
// forma —filas con una fecha y una o más columnas que apuntan a objetos de un
// bucket— pero distinto plazo y distinta sensibilidad. Escribir el barrido dos
// veces era garantizar que el orden de las operaciones se hiciera bien en una y
// mal en la otra, y ese orden es lo único que impide perder la referencia a un
// archivo que sigue existiendo.
//
// EL ORDEN, QUE ES LA REGLA: primero se borra el objeto del bucket y SOLO
// después se anula la columna. Al revés, un fallo del remove dejaría la fila
// sin path y el archivo vivo para siempre — invisible y no purgable. Al derecho,
// un fallo deja el path intacto y la corrida del mes siguiente lo reintenta.

/** Lo mínimo que esta lógica necesita de supabase-js. */
export interface ClientePurga {
  from(tabla: string): {
    select(cols: string): QueryPurga
    update(patch: Record<string, null>): { in(col: string, ids: string[]): Promise<{ error: { message: string } | null }> }
  }
  storage: {
    from(bucket: string): { remove(paths: string[]): Promise<{ error: { message: string } | null }> }
  }
}

/** Constructor de consulta encadenable, en el subconjunto que se usa aquí. */
export interface QueryPurga extends PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }> {
  not(col: string, op: string, val: unknown): QueryPurga
  or(filtro: string): QueryPurga
  lt(col: string, val: string): QueryPurga
  limit(n: number): QueryPurga
}

/** Qué purgar: una tabla, un bucket y las columnas que hay que dejar en NULL. */
export interface ObjetivoPurga {
  /** Etiqueta con la que aparece en la respuesta. */
  nombre: string
  tabla: string
  bucket: string
  /** Columna de fecha con la que se mide la antigüedad. */
  columnaFecha: string
  /** Columnas que guardan el path del objeto. Al menos una. */
  columnasFoto: string[]
  /**
   * Columnas que se anulan JUNTO con la foto sin ser paths (el GPS del
   * marcaje). Caducan con ella a propósito: sin la foto ya no sirven para lo
   * único que justificaba guardarlas, y sobrevivirle dejaría la ubicación de
   * una persona identificada como el rastro más longevo del sistema.
   */
  columnasAcompanantes?: string[]
  /**
   * Filtro extra en sintaxis PostgREST, para excluir filas cuyo "path" no lo
   * es (las fotos de lectura heredadas en base64 viven inline en la columna).
   */
  excluirLike?: string
  diasRetencion: number
}

export interface ResultadoPurga {
  nombre: string
  dias: number
  objetos_borrados: number
  filas_actualizadas: number
  iteraciones: number
  errores: string[]
}

export const BATCH_SIZE = 200
/** Tope duro por corrida (200 × 100 = 20 000 filas); evita una corrida infinita. */
export const MAX_ITERACIONES = 100

/** Instante a partir del cual una fila es vieja, en ISO. */
export function corte(dias: number, ahora = Date.now()): string {
  return new Date(ahora - dias * 86400000).toISOString()
}

/**
 * Días de retención de un objetivo, leídos del body de la petición. Un valor
 * ausente, no numérico o ≤ 0 cae al default del objetivo: nadie purga con "0
 * días" por un typo en un JSON.
 */
export function diasDelBody(body: Record<string, unknown>, claves: string[], porDefecto: number): number {
  for (const clave of claves) {
    const v = body?.[clave]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v)
  }
  return porDefecto
}

/**
 * Barre un objetivo: por lotes, borra los objetos del bucket y después anula
 * sus columnas. La fila NUNCA se borra — en `registros` es la lectura y en
 * `presencia_personal` es el marcaje, que es dato de planilla: se descarta la
 * imagen, no el hecho.
 *
 * Pagina sola: al anular las columnas, la vuelta siguiente ya no trae esas
 * filas. Por eso un lote que falla corta el bucle en vez de reintentar — si no,
 * la misma página volvería para siempre.
 */
export async function purgarObjetivo(
  admin: ClientePurga,
  objetivo: ObjetivoPurga,
  ahora = Date.now(),
): Promise<ResultadoPurga> {
  const res: ResultadoPurga = {
    nombre: objetivo.nombre,
    dias: objetivo.diasRetencion,
    objetos_borrados: 0,
    filas_actualizadas: 0,
    iteraciones: 0,
    errores: [],
  }
  const cutoff = corte(objetivo.diasRetencion, ahora)
  const cols = ['id', ...objetivo.columnasFoto].join(', ')
  // Trae la fila si CUALQUIERA de sus columnas de foto sigue puesta: una salida
  // con foto y una entrada sin ella son la misma fila y hay que barrer las dos.
  const hayAlguna = objetivo.columnasFoto.map(c => `${c}.not.is.null`).join(',')

  for (let i = 0; i < MAX_ITERACIONES; i++) {
    let q = admin.from(objetivo.tabla).select(cols).or(hayAlguna)
    if (objetivo.excluirLike) q = q.not(objetivo.columnasFoto[0], 'like', objetivo.excluirLike)
    const { data: rows, error } = await q.lt(objetivo.columnaFecha, cutoff).limit(BATCH_SIZE)
    if (error) { res.errores.push(`select: ${error.message}`); break }
    if (!rows || rows.length === 0) break

    res.iteraciones++
    const ids = rows.map(r => r.id as string)
    const paths = objetivo.columnasFoto
      .flatMap(c => rows.map(r => r[c]))
      .filter((p): p is string => typeof p === 'string' && p.length > 0)

    if (paths.length > 0) {
      // Best-effort: un objeto ausente NO es error en la Storage API (mismo
      // criterio tolerante que delete-company).
      const { error: rmErr } = await admin.storage.from(objetivo.bucket).remove(paths)
      if (rmErr) { res.errores.push(`remove: ${rmErr.message}`); break }
      res.objetos_borrados += paths.length
    }

    const patch: Record<string, null> = {}
    for (const c of [...objetivo.columnasFoto, ...(objetivo.columnasAcompanantes ?? [])]) patch[c] = null
    const { error: updErr } = await admin.from(objetivo.tabla).update(patch).in('id', ids)
    if (updErr) { res.errores.push(`update: ${updErr.message}`); break }
    res.filas_actualizadas += ids.length
  }

  return res
}
