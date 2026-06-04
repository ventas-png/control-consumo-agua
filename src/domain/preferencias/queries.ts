// plat:P18 — Hooks de LECTURA del dominio "preferencias".
//
// Lee la fila propia de user_preferences (RLS la acota a auth.uid(); además
// replicamos .eq('user_id', …) como defensa en profundidad). Convención de
// src/domain/README.md.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { preferenciasKeys } from './keys'

export interface UserPreferencesRow {
  user_id: string
  locale: string
  timezone: string
  currency: string
  updated_at?: string | null
  created_at?: string | null
}

/** Preferencias regionales del usuario (o null si aún no guardó ninguna). */
export function useMisPreferenciasQuery(userId?: string) {
  return useQuery<UserPreferencesRow | null>({
    queryKey: preferenciasKeys.mine(userId),
    queryFn: async () => {
      const rows = (await runQuery<UserPreferencesRow[]>((signal) =>
        supabase.from('user_preferences').select('*').eq('user_id', userId!).abortSignal(signal))) ?? []
      return rows[0] ?? null
    },
    enabled: !!userId,
  })
}
