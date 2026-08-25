// domain/shared/storage.ts — Acceso a Storage para los uploaders compartidos
// (ImageUploader, FileUploader). Bucket privado `condominios-media`; se persiste
// el path bare y SecureImage/useSignedUrl firma al render. T7/PR3.
import { supabase } from '../../lib/supabase'
import { BUCKET_MEDIA } from './buckets'

export { BUCKET_MEDIA, BUCKET_EVIDENCIAS } from './buckets'

/** Opciones de subida (subconjunto de FileOptions de supabase-js). */
export interface UploadMediaOptions {
  contentType?: string
  upsert?: boolean
}


/**
 * Sube un archivo a un bucket. Devuelve `{ data: { path }, error }` (el path lo
 * arma la UI con buildUploadPath). `error` es el mensaje legible.
 */
export async function uploadMedia(
  bucket: string,
  path: string,
  body: Blob | File,
  options?: UploadMediaOptions,
): Promise<{ data: { path: string } | null; error: string | null }> {
  const { data, error } = await supabase.storage.from(bucket).upload(path, body, options)
  return { data: data ? { path: data.path } : null, error: error?.message ?? null }
}

/** Elimina archivos de un bucket por path. */
export async function removeMedia(bucket: string, paths: string[]): Promise<{ error: string | null }> {
  const { error } = await supabase.storage.from(bucket).remove(paths)
  return { error: error?.message ?? null }
}

/** Atajo histórico: `uploadMedia` sobre `condominios-media`. */
export async function uploadCondominiosMedia(
  path: string,
  body: Blob | File,
  options?: UploadMediaOptions,
): Promise<{ data: { path: string } | null; error: string | null }> {
  return uploadMedia(BUCKET_MEDIA, path, body, options)
}

/** Atajo histórico: `removeMedia` sobre `condominios-media`. */
export async function removeCondominiosMedia(paths: string[]): Promise<{ error: string | null }> {
  return removeMedia(BUCKET_MEDIA, paths)
}

/**
 * Sube un documento de mudanza al bucket privado `mudanza-docs`. Devuelve `{ error }`
 * (mensaje legible). El path lo arma la UI con `buildUploadPath`.
 */
export async function uploadMudanzaDoc(
  path: string,
  body: Blob | File,
  options?: UploadMediaOptions,
): Promise<{ error: string | null }> {
  const { error } = await supabase.storage.from('mudanza-docs').upload(path, body, options)
  return { error: error?.message ?? null }
}

/**
 * Sube un documento de la solicitud de renta al bucket privado `renta-docs`.
 * Devuelve `{ error }` (mensaje legible). El path lo arma la UI con
 * `buildUploadPath(unidadId, …)`: el primer segmento DEBE ser la unidad para que
 * la RLS del bucket (20260828000100) autorice la subida.
 */
export async function uploadRentaDoc(
  path: string,
  body: Blob | File,
  options?: UploadMediaOptions,
): Promise<{ error: string | null }> {
  const { error } = await supabase.storage.from('renta-docs').upload(path, body, options)
  return { error: error?.message ?? null }
}

/** Elimina documentos del bucket `renta-docs` por path (limpieza de huérfanos). */
export async function removeRentaDocs(paths: string[]): Promise<{ error: string | null }> {
  if (paths.length === 0) return { error: null }
  const { error } = await supabase.storage.from('renta-docs').remove(paths)
  return { error: error?.message ?? null }
}
