// domain/condominios/actividad.ts — Panel "Actividad del equipo".
//
// Lee el RPC `actividad_equipo` (20260731000300), que agrega sobre las columnas
// de trazabilidad selladas por la BD (creado_por / completado_por / …). La
// autorización vive server-side: el RPC exige super_admin, company_owner o
// admin y valida que el proyecto sea de la empresa del llamador, así que aquí
// no se replica el chequeo (sería una segunda fuente de verdad que se
// desincroniza).
//
// Se usa el cliente `supabase` (sin tipar) en vez de `db`: el RPC es nuevo y no
// existe todavía en database.types.ts hasta la próxima corrida de
// `npm run gen:db-types`. El shape real lo fija el SQL y se declara aquí.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { condominiosKeys } from './keys'

/** Una fila del panel: todo lo que hizo un usuario en el período. */
export interface ActividadUsuario {
  usuario_id: string
  usuario_nombre: string
  usuario_rol: string
  lecturas: number
  lecturas_m3: number
  limpiezas: number
  checklists: number
  rondas_iniciadas: number
  puntos_marcados: number
  visitas_registradas: number
  paquetes: number
  solicitudes_creadas: number
  tareas_cerradas: number
  total: number
  ultima_actividad: string | null
}

export async function fetchActividadEquipo(
  projectId: string,
  desde: string,
  hasta: string,
): Promise<ActividadUsuario[]> {
  const { data, error } = await supabase.rpc('actividad_equipo', {
    p_project_id: projectId,
    p_desde: desde,
    p_hasta: hasta,
  })
  if (error) throw new Error(error.message)
  // El RPC devuelve los conteos como bigint, que PostgREST serializa a number
  // cuando caben en un double — el caso real aquí (nadie captura 2^53 lecturas).
  return (data as ActividadUsuario[] | null) ?? []
}

export function useActividadEquipo(
  projectId: string | undefined,
  desde: string,
  hasta: string,
) {
  return useQuery({
    queryKey: condominiosKeys.actividadEquipo(projectId, desde, hasta),
    queryFn: () => fetchActividadEquipo(projectId!, desde, hasta),
    enabled: Boolean(projectId),
  })
}
