// domain/comunicacion/broadcasts.ts — acceso a datos de comunicados (difusión).
//
// T7/PR3 #1 (Parte B): baja a la capa de dominio todo el acceso a Supabase que
// vivía inline en useBroadcasts (selects de broadcasts/broadcast_recipients, el
// update de "leído" y la llamada a la edge `create-broadcast`). El hook queda
// como un envoltorio de estado puro, sin importar `supabase`.
import { supabase } from '../../lib/supabase'
import type { Broadcast, BroadcastRecipient, BroadcastTargetType } from '../../types'

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

/**
 * Lista de comunicados enviados, enriquecida con el conteo de lecturas por
 * comunicado. Lanza si falla la lectura principal (el hook lo envuelve en su
 * try/finally para apagar el loading).
 */
export async function fetchBroadcastsWithReadCounts(): Promise<Broadcast[]> {
  const { data, error } = await supabase
    .from('broadcasts')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error

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

  return (data || []).map((b: Broadcast) => ({ ...b, read_count: readMap[b.id] || 0 }))
}

// com:N5 — el fan-out vive en la edge function `create-broadcast`: resuelve la
// audiencia y abanica (broadcast_recipients + encola emails en el orquestador)
// en el servidor, con service_role. El cliente ya NO inserta ~500 filas ni
// manda el padrón. Usamos fetch directo (como src/lib/email.ts) para leer el
// JSON de error de la edge con claridad.
export async function createBroadcast(params: CreateBroadcastParams): Promise<CreateBroadcastResult> {
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

  return {
    success: true,
    recipientCount: payload.recipientCount ?? 0,
    emailsQueued: payload.emailsQueued ?? 0,
  }
}

/** Comunicados recibidos por un cliente (portal). Degrada a [] si falla. */
export async function fetchClienteBroadcasts(clienteId: string): Promise<BroadcastRecipient[]> {
  const { data, error } = await supabase
    .from('broadcast_recipients')
    .select('*, broadcast:broadcast_id(*)')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false })

  if (error) return []
  return (data || []) as BroadcastRecipient[]
}

/** Marca un comunicado como leído (solo si aún no lo estaba). */
export async function markBroadcastRead(recipientId: string, readAt: string): Promise<void> {
  await supabase
    .from('broadcast_recipients')
    .update({ read_at: readAt })
    .eq('id', recipientId)
    .is('read_at', null)
}
