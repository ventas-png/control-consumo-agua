// domain/agua/historialLecturas.ts — Historial de lecturas que la empresa
// llevaba a mano (tabla agua_historial_lecturas, migración 20261130000000).
//
// Es referencia para comparar: NO es un cobro. No vive en `registros`, así que
// no se factura, no aparece como deuda ni suma en los totales del Historial.
import { db } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import type { Json } from '../../types/database.types'

export interface HistorialLectura {
  id: string
  contador_id: string
  project_id: string
  /** AAAA-MM-DD */
  fecha: string
  lectura: number | null
  consumo: number | null
  notas: string | null
}

/** Una fila tal como se manda a la importación (ya leída y validada en el cliente). */
export interface FilaHistorialImport {
  /** Número de fila en la hoja, para que el error diga cuál. */
  fila: number
  /** Número de serie del contador, como está en Contadores. */
  contador: string
  /** AAAA-MM-DD */
  fecha: string
  lectura: number | null
  consumo: number | null
  notas?: string | null
}

export interface ResumenImportHistorial {
  filas: number
  insertadas: number
  actualizadas: number
  contadores: number
  lectura_inicial: {
    /** Contadores sin lecturas cuya lectura inicial pasó a la última del historial. */
    actualizadas: number
    /** Debían subir y quien importó no puede editar contadores. */
    sin_permiso: number
    /** Ya tienen lecturas en el sistema: su base es la última lectura, no se toca. */
    con_lecturas: number
    /** Su historial es anterior a la fecha de instalación (medidor reemplazado). */
    anteriores_a_instalacion: number
    /** La última lectura del historial es menor que la lectura inicial actual. */
    menores: number
    /** Los contadores que cambiaron, con su nueva lectura inicial. */
    contadores: Array<{ id: string; lectura_inicial: number }>
  }
}

const COLS = 'id, contador_id, project_id, fecha, lectura, consumo, notas'

/**
 * Historial de los contadores pedidos, del más viejo al más reciente. Si la
 * tabla todavía no existe (la migración no se aplicó) devuelve vacío: la
 * comparación sigue funcionando sólo con las lecturas del sistema.
 */
export async function fetchHistorialLecturas(contadorIds: string[]): Promise<HistorialLectura[]> {
  if (contadorIds.length === 0) return []
  const { data, error } = await db
    .from('agua_historial_lecturas')
    .select(COLS)
    .in('contador_id', contadorIds)
    .order('fecha', { ascending: true })
  if (error) return []
  return (data ?? []).map(r => ({
    ...r,
    lectura: r.lectura === null ? null : Number(r.lectura),
    consumo: r.consumo === null ? null : Number(r.consumo),
  }))
}

/**
 * Todo el historial de un proyecto, diciendo si la lectura falló. Pagina para no
 * quedarse en el tope de filas de la API. Para quien tiene que distinguir «no
 * hay historial» de «no se pudo leer» (el Historial de Lecturas).
 */
export async function fetchHistorialLecturasProyectoResultado(
  projectId: string,
): Promise<{ filas: HistorialLectura[]; error: boolean }> {
  if (!projectId) return { filas: [], error: false }
  const { data, error } = await fetchAllRows<HistorialLectura>((from, to) =>
    db
      .from('agua_historial_lecturas')
      .select(COLS)
      .eq('project_id', projectId)
      .order('fecha', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )
  if (error) return { filas: [], error: true }
  return {
    filas: data.map(r => ({
      ...r,
      lectura: r.lectura === null ? null : Number(r.lectura),
      consumo: r.consumo === null ? null : Number(r.consumo),
    })),
    error: false,
  }
}

/**
 * Todo el historial de un proyecto (para la carga masiva, que compara cientos
 * de contadores a la vez: pedirlos por id haría una URL enorme). Vacío si
 * falla: el preview sigue, sólo que sin promedio del historial.
 */
export async function fetchHistorialLecturasProyecto(projectId: string): Promise<HistorialLectura[]> {
  return (await fetchHistorialLecturasProyectoResultado(projectId)).filas
}

/**
 * Importa un lote al proyecto elegido. La base busca cada contador por número
 * de serie en ESE proyecto, valida el lote entero (todo o nada) y re-importar
 * la misma fecha reemplaza la fila.
 */
export async function importarHistorialLecturas(
  projectId: string,
  filas: FilaHistorialImport[],
): Promise<{ data: ResumenImportHistorial | null; error: string | null }> {
  const { data, error } = await db.rpc('agua_historial_lecturas_importar', {
    p_project_id: projectId,
    p_filas: filas as unknown as Json,
  })
  if (error) {
    // Los errores de fila vienen como «AGUA_HISTORIAL_FILAS: … fila 3: …».
    const limpio = error.message.replace(/^AGUA_HISTORIAL_[A-Z_]+:\s*/, '')
    return { data: null, error: limpio }
  }
  return { data: (data as unknown as ResumenImportHistorial) ?? null, error: null }
}
