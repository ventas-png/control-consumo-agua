// domain/condominios/padronAutorizacion.ts — la administración resuelve las
// solicitudes de mascotas y vehículos que los residentes envían desde el portal
// (20261101000000).
//
// Aprobar y rechazar van por RPC (no por updateCondominioRow) porque el servidor
// valida la transición (solo desde 'pendiente'), sella la identidad desde
// auth.uid(), exige motivo al rechazar, garantiza el TAG único y avisa al
// residente. El gate es el mismo que la RLS de staff de cada tabla: empresa +
// permiso del tab (condominios.tab.mascotas / condominios.tab.vehiculos).
import { supabase } from '../../lib/supabase'
import type { TipoTagVehiculo } from '../../types'

export async function resolverMascota(
  id: string,
  aprobar: boolean,
  comentario?: string | null,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('resolver_mascota', {
    p_mascota_id: id,
    p_aprobar: aprobar,
    p_comentario: comentario ?? undefined,
  })
  return { error: error?.message ?? null }
}

export interface ResolverVehiculoInput {
  id: string
  aprobar: boolean
  comentario?: string | null
  /** TAG de ingreso que se entrega al aprobar (opcional: se puede asignar después). */
  tagCodigo?: string | null
  tagTipo?: TipoTagVehiculo | null
}

export async function resolverVehiculo({
  id, aprobar, comentario, tagCodigo, tagTipo,
}: ResolverVehiculoInput): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('resolver_vehiculo', {
    p_vehiculo_id: id,
    p_aprobar: aprobar,
    p_comentario: comentario ?? undefined,
    p_tag_codigo: tagCodigo ?? undefined,
    p_tag_tipo: tagTipo ?? undefined,
  })
  return { error: error?.message ?? null }
}

/** Asigna, repone o quita (`null`) el TAG de un vehículo ya autorizado. */
export async function asignarTagVehiculo(
  id: string,
  tagCodigo: string | null,
  tagTipo?: TipoTagVehiculo | null,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('asignar_tag_vehiculo', {
    p_vehiculo_id: id,
    p_tag_codigo: tagCodigo as string,
    p_tag_tipo: tagTipo ?? undefined,
  })
  return { error: error?.message ?? null }
}
