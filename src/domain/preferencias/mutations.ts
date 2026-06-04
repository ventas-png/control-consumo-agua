// plat:P18 — Hooks de ESCRITURA del dominio "preferencias".
//
// Guarda (upsert) la fila propia de user_preferences. RLS exige user_id =
// auth.uid() tanto en INSERT como en UPDATE. Tras éxito invalida la key.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { preferenciasKeys } from './keys'

export interface GuardarPreferenciasVars {
  userId: string
  locale: string
  timezone: string
  currency: string
}

export function useGuardarPreferenciasMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: GuardarPreferenciasVars) => {
      const { error } = await supabase
        .from('user_preferences')
        .upsert(
          { user_id: vars.userId, locale: vars.locale, timezone: vars.timezone, currency: vars.currency },
          { onConflict: 'user_id' },
        )
      if (error) throw error
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: preferenciasKeys.mine(vars.userId) })
    },
  })
}
