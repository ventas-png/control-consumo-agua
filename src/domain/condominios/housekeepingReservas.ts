// domain/condominios/housekeepingReservas.ts — acceso a las RPC de 20261031000000:
// el catálogo de reservas STR vinculables y el envío del informe por correo.
//
// Las dos exigen al llamador hk_acceso al proyecto del servicio (42501 / P0002 si no).
// Un error se devuelve, no se traga: la pantalla debe decirlo en vez de ofrecer una
// lista vacía como si no hubiera reservas.
import { supabase } from '../../lib/supabase'
import type { ReservaSTRVinculable } from '../../types'

export async function fetchReservasVinculables(projectId: string, unidadId?: string | null): Promise<{ data: ReservaSTRVinculable[]; error: string | null }> {
  const { data, error } = await supabase.rpc('hk_reservas_vinculables', { p_project_id: projectId, p_unidad_id: unidadId ?? null })
  if (error) return { data: [], error: error.message }
  return { data: (data as ReservaSTRVinculable[] | null) ?? [], error: null }
}

export interface ResultadoInforme {
  encolados: number
  destinatarios: string[]
  extra: boolean
}

/**
 * Encola el informe de un servicio completado por correo (sin adjunto) a dueño/admin con
 * acceso al proyecto y/o a un correo tecleado. El correo solo sale si la empresa tiene
 * Gmail conectado; la campana no interviene aquí.
 */
export async function notificarInformeHousekeeping(
  servicioId: string,
  opts: { aAdministradores: boolean; emailExtra?: string | null },
): Promise<{ data: ResultadoInforme | null; error: string | null }> {
  const { data, error } = await supabase.rpc('hk_notificar_informe', {
    p_servicio_id: servicioId,
    p_a_administradores: opts.aAdministradores,
    p_email_extra: opts.emailExtra?.trim() || null,
  })
  if (error) return { data: null, error: error.message }
  const r = (data ?? {}) as Partial<ResultadoInforme>
  return {
    data: {
      encolados: typeof r.encolados === 'number' ? r.encolados : 0,
      destinatarios: Array.isArray(r.destinatarios) ? r.destinatarios.map(String) : [],
      extra: r.extra === true,
    },
    error: null,
  }
}
