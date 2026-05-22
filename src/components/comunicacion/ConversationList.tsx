import type { Conversation } from '../../types'
import { STATUS_COLORS, STATUS_LABELS, PRIORITY_COLORS, PRIORITY_LABELS, CATEGORY_LABELS, formatDate } from './conversationConstants'

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
      <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--at-ink-3)' }}>
        <div style={{ fontSize: '32px', marginBottom: '8px' }}>💬</div>
        <div style={{ fontSize: '13px' }}>No hay conversaciones</div>
      </div>
    )
  }

  return (
    <div>
      {filtered.map(conv => {
        const isActive = conv.id === activeId
        const isUnseen = unseenConvIds.has(conv.id)
        return (
          <button
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            style={{
              width: '100%', textAlign: 'left', padding: '12px 14px',
              border: 'none', borderBottom: '1px solid var(--at-chip)',
              background: isActive ? 'var(--at-primary-tint)' : isUnseen ? 'var(--at-warning-tint)' : 'var(--at-surface)',
              cursor: 'pointer', transition: 'background 0.12s',
              display: 'flex', flexDirection: 'column', gap: '4px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
              <span style={{
                fontSize: '13px', fontWeight: isUnseen ? 700 : 600,
                color: isActive ? 'var(--at-primary-hover)' : 'var(--at-ink)', lineHeight: '1.3',
                flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}>
                {isUnseen && (
                  <span className="new-assignment-dot" style={{
                    display: 'inline-block', width: '8px', height: '8px',
                    borderRadius: '50%', background: 'var(--at-warning)', flexShrink: 0,
                  }} />
                )}
                {conv.subject}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--at-ink-3)', flexShrink: 0 }}>
                {formatDate(conv.updated_at)}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', color: 'var(--at-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {conv.cliente_nombre ?? 'Cliente'}
              </span>
              <span style={{
                fontSize: '10px', padding: '1px 6px', borderRadius: '999px',
                background: STATUS_COLORS[conv.status] + '18', color: STATUS_COLORS[conv.status],
                fontWeight: 600, flexShrink: 0,
              }}>
                {STATUS_LABELS[conv.status]}
              </span>
              <span style={{
                fontSize: '10px', padding: '1px 6px', borderRadius: '999px',
                background: PRIORITY_COLORS[conv.priority] + '18', color: PRIORITY_COLORS[conv.priority],
                fontWeight: 600, flexShrink: 0,
              }}>
                {PRIORITY_LABELS[conv.priority]}
              </span>
            </div>

            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>
              {CATEGORY_LABELS[conv.category]}
              {conv.assigned_name && ` · Asignado: ${conv.assigned_name}`}
            </div>
          </button>
        )
      })}
    </div>
  )
}
