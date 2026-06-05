import { useState, useCallback } from 'react'
import type { Broadcast, BroadcastRecipient, BroadcastTargetType } from '../types'
import { supabase } from '../lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

export interface CreateBroadcastParams {
  title: string
  body: string
  target_type: BroadcastTargetType
  target_ids: string[]
  send_email: boolean
}

export interface CreateBroadcastResult {
  success: boolean
  recipientCount: number
  /** Emails encolados en notifications_outbox (el dispatcher los envía async). */
  emailsQueued: number
  error?: string
}

interface CreateBroadcastResponse {
  success?: boolean
  recipientCount?: number
  emailsQueued?: number
  error?: string
}

export function useBroadcasts() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([])
  const [clienteBroadcasts, setClienteBroadcasts] = useState<BroadcastRecipient[]>([])
  const [loading, setLoading] = useState(false)

  const loadBroadcasts = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('broadcasts')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error

      // Fetch read counts per broadcast
      const ids = (data || []).map((b: Broadcast) => b.id)
      const readMap: Record<string, number> = {}

      if (ids.length > 0) {
        const { data: readData } = await supabase
          .from('broadcast_recipients')
          .select('broadcast_id')
          .in('broadcast_id', ids)
          .not('read_at', 'is', null)

        if (readData) {
          readData.forEach((r: { broadcast_id: string }) => {
            readMap[r.broadcast_id] = (readMap[r.broadcast_id] || 0) + 1
          })
        }
      }

      const enriched: Broadcast[] = (data || []).map((b: Broadcast) => ({
        ...b,
        read_count: readMap[b.id] || 0,
      }))

      setBroadcasts(enriched)
    } finally {
      setLoading(false)
    }
  }, [])

  // com:N5 — el fan-out vive en la edge function `create-broadcast`: resuelve la
  // audiencia y abanica (broadcast_recipients + encola emails en el orquestador)
  // en el servidor, con service_role. El cliente ya NO inserta ~500 filas ni
  // manda el padrón. Usamos fetch directo (como src/lib/email.ts) para leer el
  // JSON de error de la edge con claridad.
  const createBroadcast = useCallback(
    async (params: CreateBroadcastParams): Promise<CreateBroadcastResult> => {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token ?? ''

      let res: Response
      try {
        res = await fetch(`${SUPABASE_URL}/functions/v1/create-broadcast`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            title: params.title,
            body: params.body,
            target_type: params.target_type,
            target_ids: params.target_ids,
            send_email: params.send_email,
          }),
        })
      } catch {
        return { success: false, recipientCount: 0, emailsQueued: 0, error: 'No se pudo conectar con el servidor.' }
      }

      const payload = (await res.json().catch(() => ({}))) as CreateBroadcastResponse

      if (!res.ok || !payload.success) {
        return {
          success: false,
          recipientCount: 0,
          emailsQueued: 0,
          error: payload.error ?? 'No se pudo enviar el comunicado.',
        }
      }

      // Reload list
      await loadBroadcasts()

      return {
        success: true,
        recipientCount: payload.recipientCount ?? 0,
        emailsQueued: payload.emailsQueued ?? 0,
      }
    },
    [loadBroadcasts],
  )

  // For client portal
  const loadClienteBroadcasts = useCallback(async (clienteId: string) => {
    const { data, error } = await supabase
      .from('broadcast_recipients')
      .select('*, broadcast:broadcast_id(*)')
      .eq('cliente_id', clienteId)
      .order('created_at', { ascending: false })

    if (error) return
    setClienteBroadcasts((data || []) as BroadcastRecipient[])
  }, [])

  const markAsRead = useCallback(async (recipientId: string) => {
    const now = new Date().toISOString()
    await supabase
      .from('broadcast_recipients')
      .update({ read_at: now })
      .eq('id', recipientId)
      .is('read_at', null)
    setClienteBroadcasts(prev =>
      prev.map(r => r.id === recipientId ? { ...r, read_at: now } : r)
    )
  }, [])

  return { broadcasts, clienteBroadcasts, loading, loadBroadcasts, createBroadcast, loadClienteBroadcasts, markAsRead }
}
