// domain/presence/presence.ts — F4.4.2: acceso a datos de presencia colaborativa.
//
// T7/PR3 #1: baja el CRUD directo de `user_presence` que vivía inline en
// usePresence. El hook conserva lo que es de su capa (heartbeat con setInterval,
// el canal Realtime y el filtrado por TTL/sección); aquí queda solo el I/O.
import { reportDegradedQuery } from '../queryFetch'
import { supabase } from '../../lib/supabase'

/** Una fila de presencia activa (quién está dónde, con su último latido). */
export interface PresenceRow {
  user_id: string
  company_id: string
  project_id: string | null
  section: string | null
  record_id: string | null
  last_seen: string
}

/** Datos de un latido de presencia del usuario actual. */
export interface PresenceHeartbeat {
  userId: string | null | undefined
  companyId: string | null | undefined
  projectId?: string | null
  section?: string | null
  recordId?: string | null
  /** Timestamp ISO del latido (lo calcula el hook para mantener el control). */
  lastSeen: string
}

/**
 * UPSERT del heartbeat de presencia del usuario actual (conflict por user_id).
 * Fire-and-forget desde el hook: no devuelve error porque el estado se refresca
 * por el evento Realtime que llega de vuelta (anti-flicker).
 */
export async function upsertPresence(beat: PresenceHeartbeat): Promise<void> {
  await supabase.from('user_presence').upsert(
    {
      user_id: beat.userId,
      company_id: beat.companyId,
      project_id: beat.projectId ?? null,
      section: beat.section ?? null,
      record_id: beat.recordId ?? null,
      last_seen: beat.lastSeen,
    },
    { onConflict: 'user_id' },
  )
}

/**
 * Presencia activa de la company desde `since` (ISO). RLS acota la lectura al
 * tenant; además replicamos `.eq('company_id', …)` como defensa en profundidad.
 */
export async function fetchActivePresence(companyId: string, since: string): Promise<PresenceRow[]> {
  const { data, error } = await supabase
    .from('user_presence')
    .select('user_id, company_id, project_id, section, record_id, last_seen')
    .eq('company_id', companyId)
    .gte('last_seen', since)
  reportDegradedQuery('presence.fetchActivePresence', error)
  return (data ?? []) as PresenceRow[]
}
