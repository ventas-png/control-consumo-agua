// domain/condominios/presenciaAutoservicio.ts — El empleado marca su propio turno.
//
// Tres llamadas y una regla: la HORA no se manda nunca. `presencia_marcar`
// (20260908000000) la pone en el servidor, en la zona del tenant, y por eso
// aquí no hay ningún parámetro de fecha ni de hora — si lo hubiera, el marcaje
// valdría lo mismo que un campo de texto.
//
// El orden importa: la foto se sube ANTES de marcar, porque la RPC comprueba
// que el objeto exista en el bucket. Una foto subida sin marcaje posterior
// (la red se cae entre las dos llamadas) queda huérfana en storage y no ata
// ninguna fila; el caso contrario —una fila que afirma tener evidencia que no
// está— es el que no puede pasar.
import { supabase } from '../../lib/supabase'
import { reportDegradedQuery } from '../queryFetch'
import { BUCKET_PRESENCIA } from '../shared/buckets'
import { uploadMedia } from '../shared/storage'
import { buildUploadPath, validateFileMagic } from '../../lib/fileValidation'
import { compressImage } from '../../lib/imageCompress'
import type { CoordsMarcaje } from '../../lib/nativeGeo'
import type { MiFichaPresencia } from '../../types'

export interface ResultadoMarcaje {
  registro_id: string
  fecha: string
  hora: string
  estado: string
  tipo: 'entrada' | 'salida'
}

export type TipoMarcaje = 'entrada' | 'salida'

/**
 * Expediente, turno de hoy y marcaje ya hecho de la cuenta activa en ese
 * condominio. `null` = la cuenta no tiene expediente vinculado aquí, que NO es
 * un error: es el caso normal de un administrador, y lo que decide si la
 * pantalla de autoservicio se ofrece o no.
 */
export async function fetchMiFichaPresencia(
  projectId: string,
): Promise<{ ficha: MiFichaPresencia | null; error: string | null }> {
  const { data, error } = await supabase.rpc('presencia_mi_ficha', { p_project_id: projectId })
  reportDegradedQuery('condominios.fetchMiFichaPresencia', error)
  if (error) return { ficha: null, error: error.message }
  const filas = (data as MiFichaPresencia[] | null) ?? []
  return { ficha: filas[0] ?? null, error: null }
}

/**
 * Sube la foto del marcaje y devuelve su path. La ruta es
 * `<project_id>/<personal_id>/<archivo>` porque de ahí sacan las policies quién
 * puede leerla y la RPC si es de quien dice ser: cualquier otra forma la
 * rechazan las dos.
 */
export async function subirFotoMarcaje(
  projectId: string,
  personalId: string,
  file: File,
): Promise<{ path: string | null; error: string | null }> {
  // Magic bytes: defiende de un payload renombrado a .jpg, igual que el
  // uploader general. El bucket además solo acepta mimes de imagen.
  const magic = await validateFileMagic(file, 'image')
  if (!magic.ok) return { path: null, error: magic.reason }
  let blob: Blob
  try {
    blob = await compressImage(file)
  } catch (e) {
    return { path: null, error: e instanceof Error ? e.message : 'No se pudo procesar la foto' }
  }
  const path = buildUploadPath(`${projectId}/${personalId}`, file.name, 'jpg')
  const { error } = await uploadMedia(BUCKET_PRESENCIA, path, blob, {
    contentType: 'image/jpeg',
    // Sin upsert: la evidencia de un fichaje no se sustituye (el bucket
    // tampoco tiene policy de UPDATE).
    upsert: false,
  })
  if (error) return { path: null, error }
  return { path, error: null }
}

/**
 * Registra el marcaje. `foto` es el path que devolvió `subirFotoMarcaje`;
 * `coords` lo que dio el dispositivo (o null). Todo lo demás —fecha, hora,
 * empleado, cargo, turno y estado— lo resuelve la base.
 */
export async function marcarPresencia(params: {
  projectId: string
  tipo: TipoMarcaje
  foto?: string | null
  coords?: CoordsMarcaje | null
  observaciones?: string | null
}): Promise<{ data: ResultadoMarcaje | null; error: string | null }> {
  const { projectId, tipo, foto = null, coords = null, observaciones = null } = params
  const { data, error } = await supabase.rpc('presencia_marcar', {
    p_project_id: projectId,
    p_tipo: tipo,
    p_foto: foto,
    p_gps: coords
      ? { lat: coords.lat, lng: coords.lng, exactitud_m: coords.exactitud_m }
      : null,
    p_observaciones: observaciones,
  })
  if (error) return { data: null, error: error.message }
  const filas = (data as ResultadoMarcaje[] | null) ?? []
  return { data: filas[0] ?? null, error: null }
}
