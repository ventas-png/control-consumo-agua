import { useState, useCallback } from 'react'
import type { Broadcast, BroadcastRecipient } from '../types'
import {
  fetchBroadcastsWithReadCounts,
  createBroadcast as createBroadcastApi,
  fetchClienteBroadcasts,
  markBroadcastRead,
  type CreateBroadcastParams,
  type CreateBroadcastResult,
} from '../domain/comunicacion/broadcasts'

// Re-export para los consumidores que tipan contra el contrato del hook.
export type { CreateBroadcastParams, CreateBroadcastResult }

export function useBroadcasts() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([])
  const [clienteBroadcasts, setClienteBroadcasts] = useState<BroadcastRecipient[]>([])
  const [loading, setLoading] = useState(false)

  const loadBroadcasts = useCallback(async () => {
    setLoading(true)
    try {
      setBroadcasts(await fetchBroadcastsWithReadCounts())
    } finally {
      setLoading(false)
    }
  }, [])

  const createBroadcast = useCallback(
    async (params: CreateBroadcastParams): Promise<CreateBroadcastResult> => {
      const result = await createBroadcastApi(params)
      // Tras éxito, refresca la lista.
      if (result.success) await loadBroadcasts()
      return result
    },
    [loadBroadcasts],
  )

  // For client portal
  const loadClienteBroadcasts = useCallback(async (clienteId: string) => {
    setClienteBroadcasts(await fetchClienteBroadcasts(clienteId))
  }, [])

  const markAsRead = useCallback(async (recipientId: string) => {
    const now = new Date().toISOString()
    await markBroadcastRead(recipientId, now)
    setClienteBroadcasts(prev =>
      prev.map(r => r.id === recipientId ? { ...r, read_at: now } : r)
    )
  }, [])

  return { broadcasts, clienteBroadcasts, loading, loadBroadcasts, createBroadcast, loadClienteBroadcasts, markAsRead }
}
