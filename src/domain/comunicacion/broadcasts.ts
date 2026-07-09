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

// ── Tracking de entrega de emails por comunicado (com:N4) ──────────────────────
// Los emails de un comunicado viajan por notifications_outbox (encolados por la
// edge create-broadcast con payload.broadcast_id). El estado de cada fila es el
// ciclo de vida del envío: queued/sending → sent → read (píxel) | bounced.
// La RLS del outbox limita la lectura a owner/admin del tenant: para otros roles
// la query devuelve 0 filas y la UI simplemente no muestra stats (degradación).

export interface BroadcastEmailStats {
  /** Aún en cola o en reintento (queued/sending). */
  pendientes: number
  /** Aceptados por Gmail (sent/delivered/read). */
  enviados: number
  /** Con apertura confirmada por el píxel (cota superior: proxies prefetchean). */
  abiertos: number
  /** Rebote duro reportado (bounced). */
  rebotados: number
  /** Fallo terminal del envío (failed) o suprimido por preferencia. */
  fallidos: number
}

interface OutboxStatusRow {
  status: string
  broadcast_id: string | null
}

/** Agregador puro (testeable): filas del outbox → stats por broadcast_id. */
export function computeEmailStatsByBroadcast(rows: OutboxStatusRow[]): Record<string, BroadcastEmailStats> {
  const out: Record<string, BroadcastEmailStats> = {}
  for (const row of rows) {
    if (!row.broadcast_id) continue
    const s = (out[row.broadcast_id] ??= { pendientes: 0, enviados: 0, abiertos: 0, rebotados: 0, fallidos: 0 })
    switch (row.status) {
      case 'queued':
      case 'sending':
        s.pendientes++
        break
      case 'sent':
      case 'delivered':
        s.enviados++
        break
      case 'read':
        s.enviados++
        s.abiertos++
        break
      case 'bounced':
        s.rebotados++
        break
      case 'failed':
      case 'suppressed':
        s.fallidos++
        break
      default:
        break
    }
  }
  return out
}

/** Stats de entrega de los emails de un lote de comunicados. Degrada a {}. */
export async function fetchBroadcastEmailStats(broadcastIds: string[]): Promise<Record<string, BroadcastEmailStats>> {
  if (broadcastIds.length === 0) return {}
  const { data, error } = await supabase
    .from('notifications_outbox')
    .select('status, broadcast_id:payload->>broadcast_id')
    .eq('channel', 'email')
    .in('payload->>broadcast_id', broadcastIds)

  if (error || !data) return {}
  return computeEmailStatsByBroadcast(data as unknown as OutboxStatusRow[])
}
