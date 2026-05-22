import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { UserNotification } from '../types'

const LIMIT = 30

// Feed de notificaciones in-app del usuario actual (campana). RLS limita las
// filas a las propias. Usa Realtime para llegada instantánea + poll de respaldo.
export function useNotifications(userId?: string) {
  const [items, setItems] = useState<UserNotification[]>([])
  const unread = items.reduce((n, x) => n + (x.leido ? 0 : 1), 0)

  const load = useCallback(async () => {
    if (!userId) return
    const { data } = await supabase
      .from('user_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(LIMIT)
    if (data) setItems(data as UserNotification[])
  }, [userId])

  useEffect(() => {
    if (!userId) { setItems([]); return }
    void load()
    const channel = supabase
      .channel(`user_notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${userId}` },
        payload => setItems(prev => [payload.new as UserNotification, ...prev].slice(0, LIMIT))
      )
      .subscribe()
    const interval = setInterval(() => void load(), 60_000)
    return () => { void supabase.removeChannel(channel); clearInterval(interval) }
  }, [userId, load])

  const marcarLeida = useCallback(async (id: string) => {
    const now = new Date().toISOString()
    setItems(prev => prev.map(n => (n.id === id ? { ...n, leido: true, leido_at: now } : n)))
    await supabase.from('user_notifications').update({ leido: true, leido_at: now }).eq('id', id)
  }, [])

  const marcarTodas = useCallback(async () => {
    const ids = items.filter(n => !n.leido).map(n => n.id)
    if (ids.length === 0) return
    const now = new Date().toISOString()
    setItems(prev => prev.map(n => (n.leido ? n : { ...n, leido: true, leido_at: now })))
    await supabase.from('user_notifications').update({ leido: true, leido_at: now }).in('id', ids)
  }, [items])

  return { items, unread, load, marcarLeida, marcarTodas }
}
