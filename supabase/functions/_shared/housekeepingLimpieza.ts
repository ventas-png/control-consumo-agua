// _shared/housekeepingLimpieza.ts — drenaje de la cola de archivos de housekeeping.
//
// Sin Deno ni supabase-js: se prueba en vitest contra un cliente falso (mismo patrón que
// purgar-fotos-registros/logic.ts).
//
// QUÉ RESUELVE. Borrar un servicio o una foto elimina la FILA en una transacción; el ARCHIVO
// vive en Storage y no se puede borrar en esa misma transacción. La BD deja el archivo en
// `hk_limpieza_storage` (trigger AFTER DELETE) y esta función lo retira del bucket con el
// service-role, que es el único que puede: los clientes no tienen DELETE en el bucket.
//
// REGLAS (cada una tiene su prueba):
//   · Una fila SOLO sale de la cola cuando el borrado se confirmó. Si Storage falla, la fila
//     queda, con +1 intento, el error y una espera creciente (lo hace `hk_limpieza_fallar`).
//   · «Cero filas afectadas» no es éxito: si `confirmar` o `fallar` informan menos filas de
//     las esperadas, se reporta como error (otra pasada se llevó esas filas o no existen).
//   · Un objeto que ya no existe NO es un error: Storage no falla al borrar lo ausente.
//   · Solo se tocan objetos del bucket de housekeeping: una fila de la cola con otro bucket
//     se rechaza (la cola no puede convertirse en un borrador de archivos ajenos).
//   · Los lotes se toman con arrendamiento (FOR UPDATE SKIP LOCKED en la BD): dos drenajes
//     simultáneos no procesan lo mismo.

export const BUCKET_HOUSEKEEPING = 'housekeeping-evidencias'
export const LOTE = 100
/** Tope duro de lotes por corrida (100 × 50 = 5 000 archivos): evita una corrida infinita. */
export const MAX_LOTES = 50

export interface FilaCola {
  id: number
  bucket: string
  path: string
  intentos: number
}

type RespuestaRpc<T> = { data: T | null; error: { message: string } | null }

/** Lo mínimo que se necesita del cliente service-role de supabase-js. */
export interface ClienteLimpieza {
  rpc(nombre: string, args?: Record<string, unknown>): PromiseLike<RespuestaRpc<unknown>>
  storage: {
    from(bucket: string): {
      remove(paths: string[]): PromiseLike<{ data: unknown; error: { message: string } | null }>
    }
  }
}

export interface ResultadoLimpieza {
  tomadas: number
  borradas: number
  fallidas: number
  huerfanas_encoladas: number
  lotes: number
  errores: string[]
}

export interface OpcionesLimpieza {
  /** Solo la cola de esta empresa (el usuario que dispara el drenaje). NULL/undefined = toda. */
  company?: string | null
  /** Encola antes los objetos huérfanos del bucket (solo el cron; es un barrido de todo el bucket). */
  barrerHuerfanas?: boolean
}

const mensaje = (e: unknown): string => (e instanceof Error ? e.message : String(e))

async function rpc<T>(admin: ClienteLimpieza, nombre: string, args?: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  try {
    const { data, error } = await admin.rpc(nombre, args)
    return { data: (data as T) ?? null, error: error ? error.message : null }
  } catch (e) {
    return { data: null, error: mensaje(e) }
  }
}

/**
 * Drena la cola. Nunca lanza: todo fallo queda en `errores` y el resto de lotes sigue
 * (salvo un fallo al TOMAR, que corta el bucle: reintentar la misma consulta rota no ayuda).
 */
export async function drenarColaHousekeeping(
  admin: ClienteLimpieza,
  opciones: OpcionesLimpieza = {},
): Promise<ResultadoLimpieza> {
  const res: ResultadoLimpieza = { tomadas: 0, borradas: 0, fallidas: 0, huerfanas_encoladas: 0, lotes: 0, errores: [] }

  if (opciones.barrerHuerfanas) {
    const h = await rpc<number>(admin, 'hk_limpieza_encolar_huerfanas')
    if (h.error) res.errores.push(`huerfanas: ${h.error}`)
    else res.huerfanas_encoladas = typeof h.data === 'number' ? h.data : 0
  }

  for (let i = 0; i < MAX_LOTES; i++) {
    const t = await rpc<FilaCola[]>(admin, 'hk_limpieza_tomar', { p_company: opciones.company ?? null, p_limite: LOTE })
    if (t.error) { res.errores.push(`tomar: ${t.error}`); break }
    const filas = Array.isArray(t.data) ? t.data : []
    if (filas.length === 0) break

    res.lotes++
    res.tomadas += filas.length

    // Solo el bucket de housekeeping; lo demás se registra como fallo (queda en la cola con su error).
    const ajenas = filas.filter(f => f.bucket !== BUCKET_HOUSEKEEPING)
    const propias = filas.filter(f => f.bucket === BUCKET_HOUSEKEEPING)
    if (ajenas.length > 0) {
      await registrarFallo(admin, res, ajenas.map(f => f.id), `bucket no permitido: ${[...new Set(ajenas.map(f => f.bucket))].join(', ')}`)
    }
    if (propias.length === 0) continue

    const ids = propias.map(f => f.id)
    let errorStorage: string | null = null
    try {
      const { error } = await admin.storage.from(BUCKET_HOUSEKEEPING).remove(propias.map(f => f.path))
      if (error) errorStorage = error.message
    } catch (e) {
      errorStorage = mensaje(e)
    }

    if (errorStorage) {
      await registrarFallo(admin, res, ids, `storage: ${errorStorage}`)
      continue
    }

    const c = await rpc<number>(admin, 'hk_limpieza_confirmar', { p_ids: ids })
    if (c.error) {
      // El objeto ya se borró pero la cola no se enteró: la fila vuelve a salir en el siguiente
      // arrendamiento y borrar lo ausente no falla, así que no se pierde nada. Se reporta.
      res.errores.push(`confirmar: ${c.error}`)
      res.fallidas += ids.length
      continue
    }
    const salieron = typeof c.data === 'number' ? c.data : 0
    res.borradas += salieron
    if (salieron !== ids.length) res.errores.push(`confirmar: salieron ${salieron} de ${ids.length} filas de la cola`)
  }

  return res
}

async function registrarFallo(admin: ClienteLimpieza, res: ResultadoLimpieza, ids: number[], motivo: string): Promise<void> {
  res.fallidas += ids.length
  res.errores.push(`${motivo} (${ids.length} archivo(s))`)
  const f = await rpc<number>(admin, 'hk_limpieza_fallar', { p_ids: ids, p_error: motivo })
  if (f.error) res.errores.push(`fallar: ${f.error}`)
  else if (f.data !== ids.length) res.errores.push(`fallar: se actualizaron ${f.data ?? 0} de ${ids.length} filas`)
}
