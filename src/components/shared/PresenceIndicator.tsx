import { useState, useEffect, type CSSProperties } from 'react'
import { fetchAppUserNamesByIds } from '../../domain/usuarios/queries'
import type { PresenceRow } from '../../hooks/usePresence'

// ============================================================================
// PresenceIndicator — F4.4.2: avatares de usuarios activos en la misma seccion.
// ============================================================================
// Recibe la lista de PresenceRow de usePresence() y muestra un stack de
// avatares con tooltip (nombre + cuando se vio activo).
//
// Resuelve full_name via batch fetch de app_users — cache simple en memoria
// para evitar re-queries.

interface Props {
  others: PresenceRow[]
  /** Maximo a mostrar antes de "+N" */
  maxAvatars?: number
}

interface UserInfo { id: string; full_name: string; initials: string }

const cache = new Map<string, UserInfo>()

export function PresenceIndicator({ others, maxAvatars = 4 }: Props) {
  const [users, setUsers] = useState<Record<string, UserInfo>>({})

  useEffect(() => {
    const missing = others.map(o => o.user_id).filter(id => !cache.has(id))
    if (missing.length === 0) {
      // Hidratar state con lo que ya esta en cache
      setUsers(prev => {
        const next = { ...prev }
        for (const o of others) {
          const u = cache.get(o.user_id)
          if (u) next[o.user_id] = u
        }
        return next
      })
      return
    }
    let alive = true
    void fetchAppUserNamesByIds(missing).then((rows) => {
      if (!alive) return
      for (const r of rows) {
        const info: UserInfo = { id: r.id, full_name: r.full_name, initials: getInitials(r.full_name) }
        cache.set(r.id, info)
      }
      setUsers(prev => {
        const next = { ...prev }
        for (const o of others) {
          const u = cache.get(o.user_id)
          if (u) next[o.user_id] = u
        }
        return next
      })
    })
    return () => { alive = false }
  }, [others])

  if (others.length === 0) return null

  const visible = others.slice(0, maxAvatars)
  const overflow = others.length - visible.length

  return (
    <div
      role="status"
      aria-label={`${others.length} ${others.length === 1 ? 'persona' : 'personas'} viendo esta sección`}
      style={containerStyle}
    >
      {visible.map((o, i) => {
        const info = users[o.user_id]
        const name = info?.full_name ?? '…'
        const initials = info?.initials ?? '?'
        return (
          <span
            key={o.user_id}
            title={`${name} · ${relativeTime(o.last_seen)}`}
            style={{ ...avatarStyle, marginLeft: i === 0 ? 0 : '-8px', zIndex: maxAvatars - i }}
          >
            {initials}
          </span>
        )
      })}
      {overflow > 0 && (
        <span
          title={`+${overflow} más`}
          style={{ ...avatarStyle, marginLeft: '-8px', background: 'var(--at-chip)', color: 'var(--at-ink-2)' }}
        >
          +{overflow}
        </span>
      )}
    </div>
  )
}

function getInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  if (diffMs < 30_000) return 'activo ahora'
  if (diffMs < 60_000) return 'hace <1 min'
  const min = Math.floor(diffMs / 60_000)
  return `hace ${min} min`
}

const containerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
}

const avatarStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '28px',
  height: '28px',
  borderRadius: '50%',
  background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
  color: 'white',
  fontSize: '11px',
  fontWeight: 700,
  border: '2px solid var(--at-surface)',
  cursor: 'default',
  userSelect: 'none',
}
