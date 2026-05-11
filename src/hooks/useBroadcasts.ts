import { useState, useCallback } from 'react'
import type { Broadcast, BroadcastRecipient, BroadcastTargetType, Cliente, Unidad, UserSession } from '../types'
import { supabase } from '../lib/supabase'
import { enviarComunicadoBroadcast } from '../lib/email'

export interface CreateBroadcastParams {
  title: string
  body: string
  target_type: BroadcastTargetType
  target_ids: string[]
  send_email: boolean
  currentUser: UserSession
  /** Clientes de la empresa para resolver destinatarios */
  allClientes: Cliente[]
  /** Unidades de la empresa para resolver destinatarios por proyecto/unidad */
  allUnidades: Unidad[]
}

export interface CreateBroadcastResult {
  success: boolean
  recipientCount: number
  emailsSent: number
  emailErrors: number
  error?: string
}

function resolveClienteIds(
  params: Pick<CreateBroadcastParams, 'target_type' | 'target_ids' | 'allClientes' | 'allUnidades'>
): string[] {
  const { target_type, target_ids, allClientes, allUnidades } = params

  if (target_type === 'todos') {
    return allClientes.map(c => c.id)
  }

  if (target_type === 'clientes') {
    return target_ids
  }

  if (target_type === 'proyecto') {
    // Clientes que tienen al menos una unidad en alguno de los proyectos seleccionados
    const clienteIds = new Set<string>()
    allUnidades
      .filter(u => target_ids.includes(u.project_id) && u.cliente_id)
      .forEach(u => clienteIds.add(u.cliente_id!))
    return Array.from(clienteIds)
  }

  if (target_type === 'unidades') {
    // Clientes asignados a las unidades seleccionadas
    const clienteIds = new Set<string>()
    allUnidades
      .filter(u => target_ids.includes(u.id) && u.cliente_id)
      .forEach(u => clienteIds.add(u.cliente_id!))
    return Array.from(clienteIds)
  }

  return []
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
      let readMap: Record<string, number> = {}

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

  const createBroadcast = useCallback(
    async (params: CreateBroadcastParams): Promise<CreateBroadcastResult> => {
      const { title, body, target_type, target_ids, send_email, currentUser, allClientes, allUnidades } = params

      const clienteIds = resolveClienteIds({ target_type, target_ids, allClientes, allUnidades })

      if (clienteIds.length === 0) {
        return { success: false, recipientCount: 0, emailsSent: 0, emailErrors: 0, error: 'No hay destinatarios para los criterios seleccionados.' }
      }

      // 1. INSERT broadcast
      const { data: broadcastData, error: broadcastError } = await supabase
        .from('broadcasts')
        .insert({
          company_id: currentUser.company_id,
          title,
          body,
          sent_by_id: currentUser.user_id,
          sent_by_name: currentUser.name,
          target_type,
          target_ids,
          recipient_count: clienteIds.length,
          send_email,
        })
        .select()
        .single()

      if (broadcastError || !broadcastData) {
        return { success: false, recipientCount: 0, emailsSent: 0, emailErrors: 0, error: broadcastError?.message ?? 'Error al crear el comunicado.' }
      }

      // 2. INSERT recipients in batches of 500
      const batchSize = 500
      for (let i = 0; i < clienteIds.length; i += batchSize) {
        const batch = clienteIds.slice(i, i + batchSize).map(cid => ({
          broadcast_id: broadcastData.id,
          cliente_id: cid,
          company_id: currentUser.company_id,
        }))
        const { error: recError } = await supabase.from('broadcast_recipients').insert(batch)
        if (recError) {
          return { success: false, recipientCount: 0, emailsSent: 0, emailErrors: 0, error: recError.message }
        }
      }

      // 3. Send emails if requested
      let emailsSent = 0
      let emailErrors = 0

      if (send_email) {
        const clientesConEmail = allClientes
          .filter(c => clienteIds.includes(c.id) && c.email)
          .map(c => ({ id: c.id, email: c.email!, nombre: c.nombre }))

        if (clientesConEmail.length > 0) {
          const { sent, failed } = await enviarComunicadoBroadcast(
            clientesConEmail,
            { title, body, sent_by_name: currentUser.name },
            currentUser.company_id
          )

          emailsSent = sent.length
          emailErrors = failed.length

          // Update email_sent / email_error per recipient
          const updates = [
            ...sent.map(email => ({ email, email_sent: true, email_error: null as string | null })),
            ...failed.map(f => ({ email: f.email, email_sent: false, email_error: f.error })),
          ]

          for (const upd of updates) {
            const cliente = clientesConEmail.find(c => c.email === upd.email)
            if (!cliente) continue
            await supabase
              .from('broadcast_recipients')
              .update({ email_sent: upd.email_sent, email_error: upd.email_error })
              .eq('broadcast_id', broadcastData.id)
              .eq('cliente_id', cliente.id)
          }
        }
      }

      // Reload list
      await loadBroadcasts()

      return { success: true, recipientCount: clienteIds.length, emailsSent, emailErrors }
    },
    [loadBroadcasts]
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
