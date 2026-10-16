// domain/portal/padron.ts — el residente registra sus mascotas y vehículos desde
// el portal y pide autorización a la administración (20261101000000).
//
// Mismo circuito que la solicitud de renta (domain/portal/solicitudRenta.ts):
// el portal NO escribe `mascotas` ni `vehiculos_residentes` (sus policies de
// escritura exigen el permiso del tab, que un residente no tiene). Todo pasa por
// RPC SECURITY DEFINER que validan residencia, datos y estado en el servidor.
//
// Dos pasos a propósito: los adjuntos van a
// `padron-docs/{unidad_id}/{mascotas|vehiculos}/{fila_id}/…` y la policy del
// bucket verifica contra la fila, así que el borrador tiene que existir ANTES de
// subir.
import { supabase } from '../../lib/supabase'
import type {
  DocumentoPadron, Mascota, SexoMascota, TamanoMascota, TipoVehiculo, VacunaMascota, VehiculoResidente,
} from '../../types'

export type TipoPadron = 'mascota' | 'vehiculo'

/** Carpeta del bucket para los adjuntos de una fila. */
export function carpetaPadron(tipo: TipoPadron, unidadId: string, filaId: string): string {
  return `${unidadId}/${tipo === 'mascota' ? 'mascotas' : 'vehiculos'}/${filaId}`
}

/** Mascotas de la unidad (todas las del padrón y las solicitudes de sus residentes). */
export async function fetchMascotasUnidad(unidadId: string): Promise<{ data: Mascota[]; error: string | null }> {
  const { data, error } = await supabase
    .from('mascotas')
    .select('*')
    .eq('unidad_id', unidadId)
    .order('created_at', { ascending: false })
  return { data: (data as unknown as Mascota[] | null) ?? [], error: error?.message ?? null }
}

/** Vehículos de la unidad (todos los del padrón y las solicitudes de sus residentes). */
export async function fetchVehiculosUnidad(unidadId: string): Promise<{ data: VehiculoResidente[]; error: string | null }> {
  const { data, error } = await supabase
    .from('vehiculos_residentes')
    .select('*')
    .eq('unidad_id', unidadId)
    .order('created_at', { ascending: false })
  return { data: (data as unknown as VehiculoResidente[] | null) ?? [], error: error?.message ?? null }
}

/**
 * Crea (o recupera) el borrador del residente en la unidad y devuelve su id, que
 * es la carpeta de los adjuntos. Idempotente.
 */
export async function reservarPadron(
  tipo: TipoPadron,
  unidadId: string,
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = tipo === 'mascota'
    ? await supabase.rpc('portal_reservar_mascota', { p_unidad_id: unidadId })
    : await supabase.rpc('portal_reservar_vehiculo', { p_unidad_id: unidadId })
  return { id: (data as string | null) ?? null, error: error?.message ?? null }
}

export interface DatosMascota {
  nombre: string
  especie: Mascota['especie']
  raza?: string | null
  color?: string | null
  sexo?: SexoMascota | null
  tamano?: TamanoMascota | null
  peso_kg?: number | null
  esterilizada?: boolean | null
  microchip?: string | null
  fecha_nacimiento?: string | null
  fecha_ultima_desparasitacion?: string | null
  veterinario?: string | null
  veterinario_telefono?: string | null
  foto_url?: string | null
  notas?: string | null
  vacunas: VacunaMascota[]
}

export interface DatosVehiculo {
  placa: string
  tipo: TipoVehiculo
  marca?: string | null
  modelo?: string | null
  color?: string | null
  anio?: number | null
  notas?: string | null
}

/** Valida y envía el borrador de mascota: pasa a `pendiente` y avisa al staff. */
export async function enviarMascota(
  id: string,
  datos: DatosMascota,
  documentos: DocumentoPadron[],
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('portal_enviar_mascota', {
    p_mascota_id: id,
    p_datos: datos as never,
    p_documentos: documentos as never,
  })
  return { error: error?.message ?? null }
}

/** Valida y envía el borrador de vehículo: pasa a `pendiente` y avisa al staff. */
export async function enviarVehiculo(
  id: string,
  datos: DatosVehiculo,
  documentos: DocumentoPadron[],
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('portal_enviar_vehiculo', {
    p_vehiculo_id: id,
    p_datos: datos as never,
    p_documentos: documentos as never,
  })
  return { error: error?.message ?? null }
}

/** Descarta el borrador (el portal borra antes sus adjuntos del bucket). */
export async function descartarPadron(tipo: TipoPadron, id: string): Promise<{ error: string | null }> {
  const { error } = tipo === 'mascota'
    ? await supabase.rpc('portal_descartar_mascota', { p_mascota_id: id })
    : await supabase.rpc('portal_descartar_vehiculo', { p_vehiculo_id: id })
  return { error: error?.message ?? null }
}

/**
 * Retira una solicitud pendiente o da de baja lo ya autorizado. Lo puede hacer
 * quien lo registró o el propietario de la unidad (lo valida el servidor).
 */
export async function darDeBajaPadron(
  tipo: TipoPadron,
  id: string,
  motivo?: string | null,
): Promise<{ error: string | null }> {
  const { error } = tipo === 'mascota'
    ? await supabase.rpc('portal_baja_mascota', { p_mascota_id: id, p_motivo: motivo ?? undefined })
    : await supabase.rpc('portal_baja_vehiculo', { p_vehiculo_id: id, p_motivo: motivo ?? undefined })
  return { error: error?.message ?? null }
}
