// domain/portal/asambleas.ts — Asambleas en el portal del propietario
// (20261105000000). El residente no lee ni escribe asambleas, puntos ni votos
// por las tablas: todo pasa por dos RPC SECURITY DEFINER acotados por
// mis_unidades_propietario_ids(), con el candado de plan y la ventana de voto
// (asamblea en curso) validados en el servidor. `supabase` laxo: los RPC
// entran al esquema generado con el próximo gen:db-types.
import { supabase } from '../../lib/supabase'
import type { AsambleaPortal, TipoVoto } from '../../types'

/**
 * Asambleas del condominio de una unidad PROPIA, con sus puntos, el voto de
 * esa unidad y los totales de las finalizadas. 0 filas si la unidad no es del
 * llamante o el plan de la empresa no incluye asambleas digitales.
 */
export async function fetchAsambleasUnidad(
  unidadId: string,
): Promise<{ data: AsambleaPortal[]; error: string | null }> {
  const { data, error } = await supabase.rpc('portal_asambleas_unidad', { p_unidad_id: unidadId })
  return { data: (data as AsambleaPortal[] | null) ?? [], error: error?.message ?? null }
}

/**
 * Registra el voto de la unidad en un punto de votación. Definitivo desde el
 * portal: `yaVotado` distingue el 23505 del servidor (la unidad ya votó, quizá
 * desde otra pestaña o la administración) para que la UI lo trate como tal.
 */
export async function votarPunto(
  puntoId: string,
  unidadId: string,
  voto: TipoVoto,
): Promise<{ error: string | null; yaVotado: boolean }> {
  const { error } = await supabase.rpc('portal_votar_punto', {
    p_punto_id: puntoId,
    p_unidad_id: unidadId,
    p_voto: voto,
  })
  return { error: error?.message ?? null, yaVotado: error?.code === '23505' }
}
