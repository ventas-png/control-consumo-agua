// com (T2) — Hooks de ESCRITURA del dominio "comunicacion".
//
// Guarda (upsert) las preferencias de canal del usuario. RLS exige
// user_id = auth.uid() en INSERT y UPDATE. Tras éxito invalida la key.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { comunicacionKeys } from './keys'
import { NOTIFICATION_CHANNELS, type NotificationPreferenceMap } from './schemas'

export interface SaveNotificationPreferencesVars {
  userId: string
  /** company_id del usuario, para el scope de tenant (analítica/segmentación). */
  companyId?: string | null
  preferences: NotificationPreferenceMap
}

export function useSaveNotificationPreferencesMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: SaveNotificationPreferencesVars) => {
      const rows = NOTIFICATION_CHANNELS.map((channel) => ({
        user_id: vars.userId,
        channel,
        enabled: vars.preferences[channel],
        company_id: vars.companyId ?? null,
      }))
      const { error } = await supabase
        .from('notification_preferences')
        .upsert(rows, { onConflict: 'user_id,channel' })
      if (error) throw error
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: comunicacionKeys.notificationPreferences(vars.userId) })
    },
  })
}
