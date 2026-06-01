import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================================
// usePresence — F4.4.2: heartbeat + lectura de presencia colaborativa.
// ============================================================================
// El hook hace dos cosas:
//   1. Heartbeat cada 30s: UPSERT en user_presence con la seccion/record_id
//      donde esta el usuario actual. Mantiene last_seen = now().
//   2. Suscripcion Realtime al canal de presencia de la company actual. Devuelve
//      la lista de OTROS usuarios activos en los ultimos PRESENCE_TTL_MS
//      filtrados opcionalmente por section/record_id.
//
// Anti-flicker: el heartbeat hace UPSERT sin esperar respuesta y el state se
// actualiza por el evento Realtime que llega de vuelta. Para el usuario actual
// no agregamos su propia fila al output (filter).
//
// Cleanup: cuando el componente desmonta, no borra la fila (preserva info
// para 60s de TTL); el siguiente login del mismo user reemplazara la row.

const HEARTBEAT_INTERVAL_MS = 30_000
const PRESENCE_TTL_MS = 60_000

export interface PresenceRow {
  user_id: string
  company_id: string
  project_id: string | null
  section: string | null
  record_id: string | null
  last_seen: string
}

export interface UsePresenceOptions {
  companyId: string | null | undefined
  userId: string | null | undefined
  /** Identificador de la seccion/tab del frontend (libre) */
  section?: string | null
  /** Si esta editando un row especifico — para que otros vean conflicto */
  recordId?: string | null
  /** Project scope opcional */
  projectId?: string | null
}

interface PresenceState {
  others: PresenceRow[]
  loading: boolean
}

export function usePresence(opts: UsePresenceOptions): PresenceState {
  const { companyId, userId } = opts
  const [state, setState] = useState<PresenceState>({ others: [], loading: true })
  const lastBeatRef = useRef<UsePresenceOptions>(opts)

  // Mantener el ref actualizado para que el interval lea siempre lo ultimo
  useEffect(() => { lastBeatRef.current = opts })

  useEffect(() => {
    if (!companyId || !userId) return
    let alive = true

    async function beat() {
      const o = lastBeatRef.current
      await supabase.from('user_presence').upsert({
        user_id: o.userId,
        company_id: o.companyId,
        project_id: o.projectId ?? null,
        section: o.section ?? null,
        record_id: o.recordId ?? null,
        last_seen: new Date().toISOString(),
      }, { onConflict: 'user_id' })
    }

    // Heartbeat inicial inmediato + interval
    void beat()
    const interval = setInterval(() => { void beat() }, HEARTBEAT_INTERVAL_MS)

    // Cargar estado inicial: presencia activa de la company
    void (async () => {
      const since = new Date(Date.now() - PRESENCE_TTL_MS).toISOString()
      const { data } = await supabase
        .from('user_presence')
        .select('user_id, company_id, project_id, section, record_id, last_seen')
        .eq('company_id', companyId)
        .gte('last_seen', since)
      if (!alive) return
      const rows = (data ?? []) as PresenceRow[]
      setState({ others: rows.filter(r => r.user_id !== userId), loading: false })
    })()

    // Realtime subscription
    const channel = supabase.channel(`presence:${companyId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'user_presence',
        filter: `company_id=eq.${companyId}`,
      }, (payload) => {
        const newRow = (payload.new ?? payload.old) as PresenceRow | null
        if (!newRow || newRow.user_id === userId) return
        setState(prev => {
          const others = prev.others.filter(o => o.user_id !== newRow.user_id)
          // DELETE event: solo remove
          if (payload.eventType === 'DELETE') {
            return { ...prev, others }
          }
          // INSERT/UPDATE: refresh
          return { ...prev, others: [...others, newRow] }
        })
      })
      .subscribe()

    return () => {
      alive = false
      clearInterval(interval)
      void supabase.removeChannel(channel)
    }
  }, [companyId, userId])

  // Filtrar por section/recordId si se especifico
  const filtered = state.others.filter(o => {
    if (opts.section && o.section !== opts.section) return false
    if (opts.recordId && o.record_id !== opts.recordId) return false
    return isStillActive(o.last_seen)
  })

  return { others: filtered, loading: state.loading }
}

function isStillActive(lastSeen: string): boolean {
  return Date.now() - new Date(lastSeen).getTime() < PRESENCE_TTL_MS
}
