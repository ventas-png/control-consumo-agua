// Lecturas omitidas: paradas de una ruta que el lecturista no pudo leer
// (contador tapado por un carro, casa cerrada, perro suelto…), con su motivo y
// foto de evidencia. Migración 20261224000000.
//
// La tabla sólo se escribe por dos RPC (`omitir_lectura` y
// `descartar_lectura_omitida`); el servidor resuelve empresa y proyecto desde
// la unidad y valida permisos. Una lectura nueva del contador la resuelve sola
// (trigger en `registros`), venga de donde venga.

import { supabase } from '../../lib/supabase'
import { compressImage } from '../../lib/imageCompress'
import type { GPS } from '../../types'
import type { EstadoOmision, LecturaOmitida, MotivoOmision } from '../../lib/lecturasOmitidasReglas'

// Las reglas puras (motivos, validación, ruta de pendientes) viven aparte para
// poder importarlas sin arrastrar el cliente de Supabase.
export * from '../../lib/lecturasOmitidasReglas'

export const BUCKET_OMISIONES = 'lecturas-omitidas'

function extensionDe(tipo: string): string {
  if (tipo === 'image/png') return 'png'
  if (tipo === 'image/webp') return 'webp'
  return 'jpg'
}

function nuevoId(): string {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * Sube la foto de evidencia, comprimida, a la carpeta del proyecto
 * (`<project_id>/<id>.<ext>`): la RLS del bucket y la RPC exigen esa carpeta.
 */
export async function subirFotoOmision(
  projectId: string,
  archivo: File,
): Promise<{ path: string | null; error: string | null }> {
  let cuerpo: Blob = archivo
  try {
    cuerpo = await compressImage(archivo)
  } catch {
    // Si no se puede comprimir (formato raro), se sube tal cual.
  }
  const tipo = cuerpo.type || archivo.type || 'image/jpeg'
  const path = `${projectId}/${nuevoId()}.${extensionDe(tipo)}`
  const { error } = await supabase.storage.from(BUCKET_OMISIONES).upload(path, cuerpo, { contentType: tipo })
  return error ? { path: null, error: error.message } : { path, error: null }
}

/** Borra una foto subida cuya omisión no se llegó a guardar. */
export async function borrarFotoOmision(path: string): Promise<void> {
  await supabase.storage.from(BUCKET_OMISIONES).remove([path])
}

export interface OmisionCaptura {
  unidadId: string
  /** Contadores de la parada que quedan sin leer; vacío si la unidad no tiene. */
  contadorIds: string[]
  /** Ruta real en la que se omitió (null fuera de ruta o en una ruta armada a mano). */
  rutaId: string | null
  motivo: MotivoOmision
  detalle: string | null
  fotoPath: string | null
  gps: GPS | null
}

export async function omitirLectura(
  captura: OmisionCaptura,
): Promise<{ data: LecturaOmitida[] | null; error: string | null }> {
  const { data, error } = await supabase.rpc('omitir_lectura', {
    p_unidad_id: captura.unidadId,
    p_contador_ids: captura.contadorIds,
    p_ruta_id: captura.rutaId,
    p_motivo: captura.motivo,
    p_detalle: captura.detalle,
    p_foto_path: captura.fotoPath,
    p_gps: captura.gps,
  })
  if (error) return { data: null, error: error.message }
  return { data: (data as LecturaOmitida[] | null) ?? [], error: null }
}

/**
 * Omisiones visibles para el usuario (la RLS acota por empresa y proyecto).
 * Las pendientes van todas; las cerradas, las más recientes.
 */
export async function fetchLecturasOmitidas(
  estado: EstadoOmision,
): Promise<{ data: LecturaOmitida[]; error: string | null }> {
  let q = supabase
    .from('lecturas_omitidas')
    .select('*')
    .eq('estado', estado)
    .order('omitida_at', { ascending: estado === 'pendiente' })
  if (estado !== 'pendiente') q = q.limit(300)
  const { data, error } = await q
  return { data: (data as LecturaOmitida[] | null) ?? [], error: error?.message ?? null }
}

export async function descartarLecturaOmitida(
  id: string,
  nota: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('descartar_lectura_omitida', { p_id: id, p_nota: nota })
  return { error: error?.message ?? null }
}
