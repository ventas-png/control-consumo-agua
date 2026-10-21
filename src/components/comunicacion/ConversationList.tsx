import type { Conversation } from '../../types'
import { EmptyState } from '../shared/EmptyState'
import { PriorityPill, StatusPill } from './ConversationBadges'
import { CATEGORY_ICONS, CATEGORY_LABELS, formatDate, initials } from './conversationConstants'

interface Props {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  filter: string
  unseenConvIds: Set<string>
}

export function ConversationList({ conversations, activeId, onSelect, filter, unseenConvIds }: Props) {
  const filtered = conversations.filter(c => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return (
      c.subject.toLowerCase().includes(q) ||
      (c.cliente_nombre ?? '').toLowerCase().includes(q)
    )
  })

  if (filtered.length === 0) {
    return (
      <EmptyState
        compact
        icon="💬"
        title={filter ? `Sin resultados para “${filter}”` : 'No hay conversaciones'}
        description={filter ? 'Prueba con otro nombre o asunto.' : 'Cuando haya conversaciones aparecerán aquí.'}
      />
    )
  }

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {filtered.map(conv => {
        const isActive = conv.id === activeId
        const isUnseen = unseenConvIds.has(conv.id)
        // "Media"/"Baja" en cada fila era ruido: solo se destaca lo que pide atención.
        const showPriority = conv.priority === 'alta' || conv.priority === 'urgente'
        return (
          <li key={conv.id}>
            <button
              type="button"
              className="conv-row"
              onClick={() => onSelect(conv.id)}
              aria-current={isActive ? 'true' : undefined}
              style={{
                width: '100%', textAlign: 'left', padding: '12px 14px 12px 12px',
                borderTop: 'none', borderRight: 'none', borderBottom: '1px solid var(--at-line)',
                borderLeft: `3px solid ${isActive ? 'var(--at-primary)' : isUnseen ? 'var(--at-warning)' : 'transparent'}`,
                background: isActive ? 'var(--at-primary-tint)' : isUnseen ? 'var(--at-warning-tint)' : 'var(--at-surface)',
                cursor: 'pointer', transition: 'background 0.12s',
                display: 'flex', alignItems: 'flex-start', gap: '12px',
                color: 'var(--at-ink)',
              }}
            >
              {/* Avatar: iniciales del cliente, o el edificio para el equipo */}
              <span aria-hidden="true" style={{
                width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: conv.is_internal ? '18px' : '14px', fontWeight: 700,
                background: conv.is_internal ? 'var(--at-accent-tint)' : 'var(--at-primary-soft)',
                color: conv.is_internal ? 'var(--at-accent-dark)' : 'var(--at-primary-hover)',
              }}>
                {conv.is_internal ? '🏢' : initials(conv.cliente_nombre)}
              </span>

              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                  <span style={{
                    flex: 1, minWidth: 0, fontSize: '14px', fontWeight: isUnseen ? 800 : 700,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    display: 'flex', alignItems: 'center', gap: '6px',
                  }}>
                    {isUnseen && (
                      <span className="new-assignment-dot" title="Asignada a ti, sin ver" style={{
                        display: 'inline-block', width: '8px', height: '8px',
                        borderRadius: '50%', background: 'var(--at-warning)', flexShrink: 0,
                      }} />
                    )}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{conv.subject}</span>
                  </span>
                  <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', flexShrink: 0 }}>
                    {formatDate(conv.updated_at)}
                  </span>
                </span>

                <span style={{ fontSize: '12.5px', color: 'var(--at-ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {conv.is_internal ? 'Discusión de equipo' : (conv.cliente_nombre ?? 'Cliente')}
                </span>

                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
                  <StatusPill status={conv.status} />
                  {showPriority && <PriorityPill priority={conv.priority} />}
                  <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', whiteSpace: 'nowrap' }}>
                    {CATEGORY_ICONS[conv.category]} {CATEGORY_LABELS[conv.category]}
                  </span>
                  {conv.assigned_name && (
                    <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', whiteSpace: 'nowrap' }}>
                      · 👤 {conv.assigned_name}
                    </span>
                  )}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
