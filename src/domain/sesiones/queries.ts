// plat:P9 — Hooks de LECTURA del dominio "sesiones activas".
//
// Lee las sesiones del usuario actual vía la RPC SECURITY DEFINER get_my_sessions
// (acotada por auth.uid() en la BD; ver migración 20260604250000). RLS no aplica
// a auth.sessions desde el cliente, por eso pasa por la RPC. Convención de
// src/domain/README.md (queryFn con runQuery).
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { sesionesKeys } from './keys'

/** Una sesión de auth.sessions, proyectada por get_my_sessions(). */
export interface SesionActiva {
  id: string
  created_at: string | null
  updated_at: string | null
  refreshed_at: string | null
  not_after: string | null
  /** Nivel de autenticación: aal1 (clave) / aal2 (MFA). */
  aal: string | null
  user_agent: string | null
  ip: string | null
  /** La sesión desde la que se hace esta consulta (no se puede cerrar a sí misma). */
  is_current: boolean
}

/**
 * Sesiones activas del usuario autenticado, la más reciente primero. La RPC ya
 * las acota a auth.uid(); aquí no hace falta scope adicional. El `.rpc(...)` se
 * tipa laxo sin tipos generados de Supabase, así que se castea — mismo patrón que
 * las queries de agregados en condominios.
 */
export function useMisSesionesQuery(enabled = true) {
  return useQuery<SesionActiva[]>({
    queryKey: sesionesKeys.mine(),
    queryFn: async () =>
      ((await runQuery((signal) =>
        supabase.rpc('get_my_sessions').abortSignal(signal))) ?? []) as unknown as SesionActiva[],
    enabled,
  })
}
