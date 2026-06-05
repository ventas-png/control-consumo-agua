// com (T2) — Hooks de LECTURA del dominio "comunicacion".
//
// Convención de src/domain/README.md: un useXQuery(scope?) por entidad; la
// queryFn usa runQuery() para heredar timeout + manejo de error.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { comunicacionKeys } from './keys'
import {
  rowsToPreferenceMap,
  type NotificationPreferenceMap,
  type NotificationPreferenceRow,
} from './schemas'

/**
 * Preferencias de canal del usuario (com:N9/N10), como mapa canal→habilitado.
 * Modelo opt-out: los canales sin fila guardada quedan habilitados. RLS acota la
 * lectura a auth.uid(); además replicamos .eq('user_id', …) como defensa en
 * profundidad.
 */
export function useNotificationPreferencesQuery(userId?: string) {
  return useQuery<NotificationPreferenceMap>({
    queryKey: comunicacionKeys.notificationPreferences(userId),
    queryFn: async () => {
      const rows = (await runQuery<NotificationPreferenceRow[]>((signal) =>
        supabase
          .from('notification_preferences')
          .select('user_id, channel, enabled, company_id')
          .eq('user_id', userId!)
          .abortSignal(signal))) ?? []
      return rowsToPreferenceMap(rows)
    },
    enabled: !!userId,
  })
}

export interface TeamUser {
  id: string
  full_name: string
  role: string
}

/**
 * Usuarios staff (no clientes) activos de la empresa, para asignar conversaciones.
 * Extraído del god-section ComunicacionSection (com:N6) a la capa de datos.
 */
export function useTeamUsersQuery(companyId?: string) {
  return useQuery<TeamUser[]>({
    queryKey: comunicacionKeys.teamUsers(companyId),
    queryFn: async () =>
      (await runQuery<TeamUser[]>((signal) =>
        supabase
          .from('app_users')
          .select('id, full_name, role')
          .eq('company_id', companyId!)
          .eq('activo', true)
          .neq('role', 'cliente')
          .order('full_name')
          .abortSignal(signal))) ?? [],
    enabled: !!companyId,
  })
}
