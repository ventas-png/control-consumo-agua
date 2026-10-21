import type { CSSProperties } from 'react'
import { PRIORITY_COLORS, PRIORITY_LABELS, STATUS_COLORS, STATUS_LABELS, tint } from './conversationConstants'
import type { ConversationPriority, ConversationStatus } from '../../types'

// Píldoras de estado y prioridad de una conversación. Lista y detalle usan las
// mismas, así un "Cerrada" o un "Alta" se leen igual en las dos vistas.

function pill(color: string, size: 'sm' | 'md'): CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: '5px',
    padding: size === 'sm' ? '2px 8px' : '3px 10px',
    borderRadius: '999px',
    fontSize: size === 'sm' ? '11px' : '12px',
    fontWeight: 700, lineHeight: 1.4, whiteSpace: 'nowrap',
    background: tint(color), color, border: `1px solid ${tint(color, 30)}`,
  }
}

export function StatusPill({ status, size = 'sm' }: { status: ConversationStatus; size?: 'sm' | 'md' }) {
  const color = STATUS_COLORS[status]
  return (
    <span style={pill(color, size)}>
      <span aria-hidden="true" style={{ width: '6px', height: '6px', borderRadius: '50%', background: color }} />
      {STATUS_LABELS[status]}
    </span>
  )
}

export function PriorityPill({ priority, size = 'sm' }: { priority: ConversationPriority; size?: 'sm' | 'md' }) {
  const color = PRIORITY_COLORS[priority]
  return (
    <span style={pill(color, size)}>
      {priority === 'urgente' ? '⚡ ' : ''}{PRIORITY_LABELS[priority]}
    </span>
  )
}
