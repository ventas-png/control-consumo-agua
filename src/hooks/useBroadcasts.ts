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
  // fetchBroadcastsWithReadCounts LANZA si falla la lectura (contrato de la capa
  // domain). Sin este catch la promesa quedaba rechazada sin manejar y la lista
  // se quedaba vacía: en pantalla, un fallo real (RLS, red, sesión caducada) era
  // indistinguible de "no hay comunicados enviados todavía".
  const [error, setError] = useState<string | null>(null)

  const loadBroadcasts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setBroadcasts(await fetchBroadcastsWithReadCounts())
    } catch (err: unknown) {
      const msg = err instanceof Error
        ? err.message
        : (err as { message?: string } | null)?.message ?? 'Error desconocido'
      setError(msg)
      setBroadcasts([])
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

  return { broadcasts, clienteBroadcasts, loading, error, loadBroadcasts, createBroadcast, loadClienteBroadcasts, markAsRead }
}
