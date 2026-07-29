// domain/comunicacion/notifications.ts — feed de notificaciones in-app del
// usuario actual (la campana).
//
// T7/PR3 #1: baja el CRUD directo de `user_notifications` que vivía inline en
// useNotifications. El hook conserva la suscripción Realtime, el poll de respaldo
// y el estado local optimista; aquí queda solo el I/O.
import { reportDegradedQuery } from '../queryFetch'
import { supabase } from '../../lib/supabase'
import type { UserNotification } from '../../types'

/**
 * Últimas `limit` notificaciones del usuario actual, las más recientes primero.
 * RLS acota las filas a las propias.
 */
export async function fetchUserNotifications(limit: number): Promise<UserNotification[]> {
  const { data, error } = await supabase
    .from('user_notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  reportDegradedQuery('comunicacion.fetchUserNotifications', error)
  return (data ?? []) as UserNotification[]
}

/**
 * Marca una notificación como leída. El hook ya aplicó el update optimista, por
 * eso es fire-and-forget (no propaga error).
 */
export async function markNotificationRead(id: string, leidoAt: string): Promise<void> {
  await supabase
    .from('user_notifications')
    .update({ leido: true, leido_at: leidoAt })
    .eq('id', id)
}

/** Marca varias notificaciones como leídas (acción "marcar todas"). No-op si vacío. */
export async function markNotificationsRead(ids: string[], leidoAt: string): Promise<void> {
  if (ids.length === 0) return
  await supabase
    .from('user_notifications')
    .update({ leido: true, leido_at: leidoAt })
    .in('id', ids)
}
