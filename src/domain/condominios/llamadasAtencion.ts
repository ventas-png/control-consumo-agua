// domain/condominios/llamadasAtencion.ts — Llamadas de atención y sanciones al
// personal (20261115000000): vocabulario, firmas y las tres RPCs.
//
// El orden importa, igual que en presencia: la firma se sube ANTES de emitir o
// de acusar, porque la fila (o la RPC) exige que el objeto exista en el bucket.
// Una firma subida sin fila posterior queda huérfana y no prueba nada; el caso
// contrario —una carta que afirma tener una firma que no está— es el que no
// puede pasar. El id de la carta lo genera el cliente para poder subir la
// firma del emisor bajo `<project>/<carta>/` antes del INSERT.
import { db, supabase } from '../../lib/supabase'
import { reportDegradedQuery } from '../queryFetch'
import { BUCKET_RRHH_LLAMADAS } from '../shared/buckets'
import { uploadMedia } from '../shared/storage'
import { buildUploadPath, validateFileMagic } from '../../lib/fileValidation'
import type {
  EstadoLlamadaAtencion, LlamadaAtencionMia, LlamadaAtencionPersonal, TipoLlamadaAtencion,
} from '../../types'

export const TIPO_LLAMADA: Record<TipoLlamadaAtencion, { label: string; titulo: string; icon: string }> = {
  llamada_atencion: { label: 'Llamada de atención', titulo: 'LLAMADA DE ATENCIÓN', icon: '⚠️' },
  amonestacion:     { label: 'Amonestación escrita', titulo: 'AMONESTACIÓN ESCRITA', icon: '📝' },
  suspension:       { label: 'Suspensión', titulo: 'SUSPENSIÓN SIN GOCE DE SALARIO', icon: '⛔' },
  otra:             { label: 'Otra sanción', titulo: 'SANCIÓN DISCIPLINARIA', icon: '📋' },
}
export const TIPOS_LLAMADA = Object.keys(TIPO_LLAMADA) as TipoLlamadaAtencion[]

export const ESTADO_LLAMADA: Record<EstadoLlamadaAtencion, { label: string; bg: string; color: string }> = {
  pendiente: { label: 'Por firmar', bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  acusada:   { label: 'Firmada de recibido', bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  anulada:   { label: 'Anulada', bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
}

export const tipoLlamadaLabel = (tipo: string) => TIPO_LLAMADA[tipo as TipoLlamadaAtencion]?.label ?? tipo
export const tipoLlamadaTitulo = (tipo: string) => TIPO_LLAMADA[tipo as TipoLlamadaAtencion]?.titulo ?? 'SANCIÓN DISCIPLINARIA'

/** Nombre del acuse: sin espacios sobrantes y con al menos dos palabras de dos letras. */
export function nombreAcuseValido(nombre: string): boolean {
  const partes = nombre.trim().split(/\s+/).filter(p => p.length >= 2)
  return partes.length >= 2
}

/**
 * Sube una firma (PNG del SignaturePad) bajo `<project_id>/<llamada_id>/` y
 * devuelve su path. La ruta es exactamente lo que las policies del bucket y la
 * RPC de acuse comprueban; cualquier otra forma la rechazan las dos.
 */
export async function subirFirmaLlamada(
  projectId: string,
  llamadaId: string,
  file: File,
  cual: 'emisor' | 'acuse',
): Promise<{ path: string | null; error: string | null }> {
  const magic = await validateFileMagic(file, 'image')
  if (!magic.ok) return { path: null, error: magic.reason }
  const path = buildUploadPath(`${projectId}/${llamadaId}`, `${cual}.png`, 'png')
  const { error } = await uploadMedia(BUCKET_RRHH_LLAMADAS, path, file, { contentType: 'image/png', upsert: false })
  if (error) return { path: null, error }
  return { path, error: null }
}

export interface NuevaLlamadaAtencion {
  id: string
  companyId: string
  projectId: string
  personalId: string
  /** Etiqueta del cargo del catálogo (p. ej. «Guardia»); el trigger cae al código si va vacía. */
  empleadoCargo: string
  tipo: TipoLlamadaAtencion
  fechaHechos: string
  motivo: string
  descripcion: string
  fundamento: string
  diasSuspension: number | null
  firmaEmisorPath: string
}

/** Emite la carta. El trigger sella emisor, hora y snapshot del empleado, y avisa a su cuenta. */
export async function emitirLlamadaAtencion(n: NuevaLlamadaAtencion): Promise<{ error: { message: string } | null }> {
  const { error } = await db.from('llamadas_atencion_personal').insert({
    id: n.id,
    company_id: n.companyId,
    project_id: n.projectId,
    personal_id: n.personalId,
    empleado_cargo: n.empleadoCargo.trim() || null,
    tipo: n.tipo,
    fecha_hechos: n.fechaHechos,
    motivo: n.motivo.trim(),
    descripcion: n.descripcion.trim(),
    fundamento: n.fundamento.trim() || null,
    dias_suspension: n.tipo === 'suspension' ? n.diasSuspension : null,
    firma_emisor_path: n.firmaEmisorPath,
  })
  return { error: error ? { message: error.message } : null }
}

/** Firma de recibido: el propio empleado o, en persona, quien tiene `.edit` sobre el tab. */
export async function acusarLlamadaAtencion(
  llamadaId: string,
  nombre: string,
  firmaPath: string,
): Promise<{ data: LlamadaAtencionPersonal | null; error: { message: string } | null }> {
  const { data, error } = await db.rpc('rrhh_llamada_acusar', {
    p_id: llamadaId, p_nombre: nombre.trim(), p_firma_path: firmaPath,
  })
  return { data: (data as unknown as LlamadaAtencionPersonal | null) ?? null, error: error ? { message: error.message } : null }
}

/** Deja la carta sin efecto (`.change_status`). No la borra. */
export async function anularLlamadaAtencion(
  llamadaId: string,
  motivo: string,
): Promise<{ error: { message: string } | null }> {
  const { error } = await db.rpc('rrhh_llamada_anular', { p_id: llamadaId, p_motivo: motivo.trim() })
  return { error: error ? { message: error.message } : null }
}

/**
 * Las cartas dirigidas a la cuenta activa (rrhh_llamadas_mias), pendientes
 * primero. Vacío no es error: es el caso normal de quien no es empleado.
 */
export async function fetchMisLlamadasAtencion(): Promise<{ data: LlamadaAtencionMia[]; error: string | null }> {
  const { data, error } = await db.rpc('rrhh_llamadas_mias')
  reportDegradedQuery('condominios.fetchMisLlamadasAtencion', error)
  if (error) return { data: [], error: error.message }
  return { data: (data as unknown as LlamadaAtencionMia[] | null) ?? [], error: null }
}

/** Baja una firma del bucket (para el PDF). null si no se pudo. */
export async function descargarFirmaLlamada(path: string): Promise<Blob | null> {
  const { data, error } = await supabase.storage.from(BUCKET_RRHH_LLAMADAS).download(path)
  return error ? null : data
}

export const nombrePdfLlamada = (l: Pick<LlamadaAtencionPersonal, 'tipo' | 'empleado_nombre' | 'fecha_hechos'>) =>
  `${tipoLlamadaLabel(l.tipo)}-${l.empleado_nombre}-${l.fecha_hechos}.pdf`
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_')
