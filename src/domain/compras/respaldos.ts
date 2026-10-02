// Respaldos de recepción — evidencia de entrega (bienes) o conformidad (servicios).
//
// El archivo va al bucket PRIVADO `recepciones-respaldo` con la ruta
// <empresa>/<proyecto|empresa>/<recepción>/<archivo>; luego `compras_recepcion_adjuntar` lo
// registra con su tipo, MIME, tamaño y SHA-256 (quién y cuándo los pone el servidor). El
// servidor vuelve a validar todo lo de aquí: este módulo solo evita subir lo que sabemos que
// se va a rechazar.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { comprasKeys } from './keys'
import type { RecepcionRespaldo, TipoRespaldoRecepcion } from '../../types/compras'

export const BUCKET_RESPALDOS_RECEPCION = 'recepciones-respaldo'
export const MAX_BYTES_RESPALDO = 10 * 1024 * 1024
export const MIME_RESPALDO = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const

const EXT_POR_MIME: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
}

/** Mensaje si el archivo no sirve como respaldo; null si pasa. */
export function validarArchivoRespaldo(f: { name: string; type: string; size: number }): string | null {
  if (!(MIME_RESPALDO as readonly string[]).includes(f.type)) return 'Solo se aceptan PDF, JPG, PNG o WEBP.'
  if (f.size <= 0) return 'El archivo está vacío.'
  if (f.size > MAX_BYTES_RESPALDO) return `El archivo pesa más de ${MAX_BYTES_RESPALDO / 1024 / 1024} MB.`
  return null
}

/** Nombre simple y único: sin rutas, espacios ni acentos; el nombre original se guarda aparte. */
export function nombreSeguroRespaldo(original: string, mime: string, unico: string): string {
  const base = original
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'respaldo'
  return `${base}-${unico}.${EXT_POR_MIME[mime] ?? 'bin'}`
}

export function rutaRespaldoRecepcion(
  companyId: string, projectId: string | null, recepcionId: string, nombreSeguro: string,
): string {
  return `${companyId}/${projectId ?? 'empresa'}/${recepcionId}/${nombreSeguro}`
}

export async function sha256Archivo(buffer: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('Este navegador no puede calcular la huella del archivo.')
  const h = new Uint8Array(await subtle.digest('SHA-256', buffer))
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('')
}

export interface AdjuntarRespaldoInput {
  companyId: string
  projectId: string | null
  recepcionId: string
  archivo: File
  tipo: TipoRespaldoRecepcion
  notas?: string | null
}

/** Sube el archivo y lo registra. Reintentar con el mismo archivo no duplica (idempotente por ruta). */
export async function adjuntarRespaldoRecepcion(i: AdjuntarRespaldoInput): Promise<{ respaldo: RecepcionRespaldo; reutilizado: boolean }> {
  const problema = validarArchivoRespaldo(i.archivo)
  if (problema) throw new Error(problema)
  const buffer = await i.archivo.arrayBuffer()
  const sha256 = await sha256Archivo(buffer)
  // El sufijo sale del contenido: el mismo archivo da la misma ruta (reintento seguro) y uno distinto, otra.
  const ruta = rutaRespaldoRecepcion(i.companyId, i.projectId, i.recepcionId,
    nombreSeguroRespaldo(i.archivo.name, i.archivo.type, sha256.slice(0, 10)))
  const { error: errSubida } = await supabase.storage.from(BUCKET_RESPALDOS_RECEPCION)
    .upload(ruta, i.archivo, { contentType: i.archivo.type, upsert: false })
  // «ya existe» es un reintento del mismo archivo: se sigue al registro, que es idempotente.
  if (errSubida && !/already exists|duplicate/i.test(errSubida.message)) throw new Error(errSubida.message)
  const { data, error } = await supabase.rpc('compras_recepcion_adjuntar', {
    p_recepcion_id: i.recepcionId, p_ruta: ruta, p_nombre: i.archivo.name, p_mime: i.archivo.type,
    p_bytes: i.archivo.size, p_sha256: sha256, p_tipo: i.tipo, p_notas: i.notas ?? null,
  })
  if (error) throw new Error(error.message)
  return data as { respaldo: RecepcionRespaldo; reutilizado: boolean }
}

export function useAdjuntarRespaldoMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: adjuntarRespaldoRecepcion,
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: comprasKeys.respaldos(v.recepcionId) })
      void qc.invalidateQueries({ queryKey: comprasKeys.all })
    },
  })
}

/** Retira un archivo SOLO mientras la recepción es borrador (el servidor lo impide después). */
export function useRetirarRespaldoMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (r: RecepcionRespaldo) => {
      const { error } = await supabase.from('recepcion_respaldos').delete().eq('id', r.id)
      if (error) throw new Error(error.message)
      await supabase.storage.from(BUCKET_RESPALDOS_RECEPCION).remove([r.ruta])
    },
    onSuccess: (_d, r) => {
      void qc.invalidateQueries({ queryKey: comprasKeys.respaldos(r.recepcion_id) })
      void qc.invalidateQueries({ queryKey: comprasKeys.all })
    },
  })
}

/** Enlace firmado y corto: el bucket es privado. */
export async function urlRespaldoRecepcion(ruta: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_RESPALDOS_RECEPCION).createSignedUrl(ruta, 300)
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'No se pudo abrir el archivo.')
  return data.signedUrl
}
