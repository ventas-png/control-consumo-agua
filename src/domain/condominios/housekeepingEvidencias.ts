// domain/condominios/housekeepingEvidencias.ts — fotos de evidencia de un servicio
// de housekeeping (estado de la unidad al ingresar y al cerrar).
//
// El orden de las operaciones es la regla, igual que en la purga:
//   subir  → primero el objeto, después la fila. Si la fila falla se retira el
//            objeto para no dejar un archivo que ninguna fila referencia.
//   borrar → primero la fila, después el objeto. Si el objeto falla queda un
//            huérfano inofensivo (nadie lo referencia); al revés quedaría una
//            fila que apunta a un archivo que ya no existe.
import { supabase } from '../../lib/supabase'
import { compressImage } from '../../lib/imageCompress'
import { buildUploadPath, validateFileMagic } from '../../lib/fileValidation'
import { BUCKET_HOUSEKEEPING } from '../shared/buckets'
import { uploadMedia, removeMedia } from '../shared/storage'
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
  if (error) {
    await removeMedia(BUCKET_HOUSEKEEPING, [path])
    return { data: null, error: error.message }
  }
  return { data: data as FotoHousekeeping, error: null }
}

export async function eliminarFotoServicio(foto: FotoHousekeeping): Promise<{ error: string | null }> {
  const { error } = await supabase.from('servicio_housekeeping_fotos').delete().eq('id', foto.id)
  if (error) return { error: error.message }
  if (foto.path) await removeMedia(BUCKET_HOUSEKEEPING, [foto.path])
  return { error: null }
}

/**
 * Borra el servicio y sus objetos. Borrar solo la fila dejaría las fotos
 * huérfanas en el bucket (el CASCADE no llega a Storage).
 */
export async function eliminarServicioConEvidencias(servicioId: string): Promise<{ error: string | null }> {
  const { data } = await supabase
    .from('servicio_housekeeping_fotos').select('path').eq('servicio_id', servicioId)
  const paths = (data ?? []).map(r => r.path as string | null).filter((p): p is string => !!p)
  const { error } = await supabase.from('servicios_housekeeping').delete().eq('id', servicioId)
  if (error) return { error: error.message }
  if (paths.length > 0) await removeMedia(BUCKET_HOUSEKEEPING, paths)
  return { error: null }
}
