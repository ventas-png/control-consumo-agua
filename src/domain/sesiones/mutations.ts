// plat:P9 — Hooks de ESCRITURA del dominio "sesiones activas".
//
// Cierran sesiones vía las RPC SECURITY DEFINER revoke_my_session /
// revoke_other_my_sessions (acotadas por auth.uid() en la BD). Tras éxito
// invalidan la key de sesiones para refrescar el listado. Convención de
// src/domain/README.md.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { sesionesKeys } from './keys'

/** Cierra una sesión concreta del usuario (no puede ser la sesión en curso). */
export function useRevocarSesionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { error } = await supabase.rpc('revoke_my_session', { p_session_id: sessionId })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sesionesKeys.mine() })
    },
  })
}

/** Cierra todas las sesiones del usuario EXCEPTO la actual. Devuelve cuántas. */
export function useRevocarOtrasSesionesMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('revoke_other_my_sessions')
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sesionesKeys.mine() })
    },
  })
}
