// domain/condominios/housekeepingEvidencias.ts — fotos de evidencia de un servicio
// de housekeeping (estado de la unidad al ingresar y al cerrar).
//
// Los clientes NO tienen DELETE ni UPDATE sobre la tabla de fotos ni sobre el bucket
// (20261028000000): borrar pasa por dos RPC que autorizan la acción, exigen exactamente una
// fila afectada y dejan los archivos en una cola que drena una edge function con reintentos.
//   subir  → primero el objeto, después la fila. Si la fila falla, el objeto queda sin fila:
//            no se intenta borrarlo desde aquí (no hay permiso, a propósito); el barrido de
//            huérfanos de la cola lo retira pasado un día.
//   borrar → RPC (fila + cola, atómico) y después se pide la limpieza. Si la limpieza falla
//            el borrado SIGUE siendo válido: el archivo queda en la cola y se reintenta.
import { supabase } from '../../lib/supabase'
import { compressImage } from '../../lib/imageCompress'
import { buildUploadPath, validateFileMagic } from '../../lib/fileValidation'
import { BUCKET_HOUSEKEEPING } from '../shared/buckets'
import { uploadMedia } from '../shared/storage'
import type { FaseFotoHousekeeping, FotoHousekeeping } from '../../types'

/** Tope por fase; lo impone también la BD (hk_fotos_preparar). */
export const MAX_FOTOS_POR_FASE = 20

/** Cuántas de `nuevas` caben sin pasar del tope, dadas las `actuales`. */
export function cupoDisponible(actuales: number, nuevas: number, max = MAX_FOTOS_POR_FASE): number {
  return Math.max(0, Math.min(nuevas, max - actuales))
}

const COLS = 'id, servicio_id, fase, path, created_at, creado_por'

export async function listarFotosServicio(servicioId: string): Promise<{ data: FotoHousekeeping[]; error: string | null }> {
  const { data, error } = await supabase
    .from('servicio_housekeeping_fotos').select(COLS)
    .eq('servicio_id', servicioId).order('created_at', { ascending: true })
  return { data: (data ?? []) as FotoHousekeeping[], error: error?.message ?? null }
}

/** Valida, comprime a JPEG (1280 px), sube al bucket y registra la fila. */
export async function subirFotoServicio(args: {
  projectId: string; servicioId: string; fase: FaseFotoHousekeeping; file: File
}): Promise<{ data: FotoHousekeeping | null; error: string | null }> {
  const { projectId, servicioId, fase, file } = args
  const magic = await validateFileMagic(file, 'image')
  if (!magic.ok) return { data: null, error: magic.reason }

  let blob: Blob
  try { blob = await compressImage(file) } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'No se pudo procesar la imagen' }
  }
  // Exactamente <project>/<servicio>/<archivo>: lo que exigen las policies.
  const path = buildUploadPath(`${projectId}/${servicioId}`, file.name, 'jpg')
  const up = await uploadMedia(BUCKET_HOUSEKEEPING, path, blob, { contentType: 'image/jpeg', upsert: false })
  if (up.error) return { data: null, error: up.error }

  const { data, error } = await supabase
    .from('servicio_housekeeping_fotos')
    .insert({ servicio_id: servicioId, fase, path })
    .select(COLS).single()
  // Si falla el INSERT el objeto queda sin fila (ver cabecera): lo retira el barrido de huérfanos.
  if (error) return { data: null, error: error.message }
  return { data: data as FotoHousekeeping, error: null }
}

/** `ok` = la cola quedó drenada; `pendiente` = quedan archivos por retirar (se reintentan solos). */
export type EstadoLimpieza = 'ok' | 'pendiente'

/**
 * Pide a la edge function que retire de Storage lo que la BD encoló. NO lanza y NO invalida el
 * borrado: si falla, los archivos siguen en la cola y la limpieza horaria los reintenta.
 */
export async function pedirLimpiezaArchivos(): Promise<EstadoLimpieza> {
  try {
    const { data, error } = await supabase.functions.invoke('housekeeping-limpieza', { body: {} })
    if (error) return 'pendiente'
    const r = data as { success?: boolean } | null
    return r && r.success === true ? 'ok' : 'pendiente'
  } catch {
    return 'pendiente'
  }
}

/** Elimina una foto (RPC autorizada). El error trae el mensaje legible de la BD. */
export async function eliminarFotoServicio(foto: FotoHousekeeping): Promise<{ error: string | null; limpieza: EstadoLimpieza }> {
  const { error } = await supabase.rpc('hk_eliminar_foto', { p_foto_id: foto.id })
  if (error) return { error: error.message, limpieza: 'ok' }
  // Una foto ya depurada (path NULL) no deja archivo: no hay nada que limpiar.
  return { error: null, limpieza: foto.path ? await pedirLimpiezaArchivos() : 'ok' }
}

/**
 * Elimina el servicio y sus fotos (RPC autorizada: solo admin/owner de la empresa). Devuelve
 * cuántos archivos quedaron encolados. Una respuesta que no es un número es un error: no se
 * da por hecho un borrado que no se pudo confirmar.
 */
export async function eliminarServicioConEvidencias(servicioId: string): Promise<{ error: string | null; fotosEncoladas: number; limpieza: EstadoLimpieza }> {
  const { data, error } = await supabase.rpc('hk_eliminar_servicio', { p_servicio_id: servicioId })
  if (error) return { error: error.message, fotosEncoladas: 0, limpieza: 'ok' }
  if (typeof data !== 'number') {
    return { error: 'No se pudo confirmar la eliminación del servicio (respuesta inesperada del servidor)', fotosEncoladas: 0, limpieza: 'ok' }
  }
  return { error: null, fotosEncoladas: data, limpieza: data > 0 ? await pedirLimpiezaArchivos() : 'ok' }
}

/** Descarga el objeto de una foto de evidencia (para armar el informe PDF). */
export async function descargarFotoServicio(path: string): Promise<Blob | null> {
  const { data, error } = await supabase.storage.from(BUCKET_HOUSEKEEPING).download(path)
  return error ? null : data
}
