// domain/shared/storage.ts — Acceso a Storage para los uploaders compartidos
// (ImageUploader, FileUploader). Bucket privado `condominios-media`; se persiste
// el path bare y SecureImage/useSignedUrl firma al render. T7/PR3.
import { supabase } from '../../lib/supabase'

/** Opciones de subida (subconjunto de FileOptions de supabase-js). */
export interface UploadMediaOptions {
  contentType?: string
  upsert?: boolean
}

/**
 * Sube un archivo al bucket `condominios-media`. Devuelve `{ data: { path }, error }`
 * (el path lo arma la UI con buildUploadPath). `error` es el mensaje legible.
 */
export async function uploadCondominiosMedia(
  path: string,
  body: Blob | File,
  options?: UploadMediaOptions,
): Promise<{ data: { path: string } | null; error: string | null }> {
  const { data, error } = await supabase.storage.from('condominios-media').upload(path, body, options)
  return { data: data ? { path: data.path } : null, error: error?.message ?? null }
}

/** Elimina archivos del bucket `condominios-media` por path. */
export async function removeCondominiosMedia(paths: string[]): Promise<{ error: string | null }> {
  const { error } = await supabase.storage.from('condominios-media').remove(paths)
  return { error: error?.message ?? null }
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
