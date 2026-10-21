import { STATUS_COLORS } from './conversationConstants'
import type { ConversationStatus } from '../../types'

// Stats rápidas del centro de comunicación. Cada tarjeta es además un atajo de
// filtro: tocar "Abiertas" deja la lista solo con esas, tocarla otra vez quita
// el filtro. Los colores son los mismos de las píldoras de estado de la lista.
export interface ConversationStats {
  abiertas: number
  en_progreso: number
  esperando: number
  resueltas: number
}

interface Props {
  stats: ConversationStats
  activeStatus?: ConversationStatus | 'todas'
  onSelectStatus?: (status: ConversationStatus | 'todas') => void
}

export function ConversationStatsBar({ stats, activeStatus = 'todas', onSelectStatus }: Props) {
  const cards: { label: string; value: number; status: ConversationStatus }[] = [
    { label: 'Abiertas', value: stats.abiertas, status: 'abierta' },
    { label: 'En progreso', value: stats.en_progreso, status: 'en_progreso' },
    { label: 'Esperando', value: stats.esperando, status: 'esperando_cliente' },
    { label: 'Resueltas', value: stats.resueltas, status: 'resuelta' },
  ]
  return (
    <div className="conv-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '12px' }}>
      {cards.map(s => {
        const color = STATUS_COLORS[s.status]
        const active = activeStatus === s.status
        const edge = active ? color : 'var(--at-line)'
        return (
          <button
            key={s.label}
            type="button"
            className="conv-stat"
            aria-pressed={active}
            title={active ? 'Quitar filtro' : `Ver solo: ${s.label.toLowerCase()}`}
            onClick={() => onSelectStatus?.(active ? 'todas' : s.status)}
            style={{
              textAlign: 'left', cursor: onSelectStatus ? 'pointer' : 'default',
              background: active ? `color-mix(in srgb, ${color} 10%, var(--at-surface))` : 'var(--at-surface)',
              // Lados por separado: mezclar `border` con `borderTop` y cambiar uno
              // al re-renderizar hace que React advierta (y pinte mal).
              borderTop: `3px solid ${color}`,
              borderRight: `1px solid ${edge}`,
              borderBottom: `1px solid ${edge}`,
              borderLeft: `1px solid ${edge}`,
              borderRadius: '12px',
              padding: '12px 14px',
              boxShadow: active ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
              transition: 'border-color 0.12s ease, background 0.12s ease',
            }}
          >
            <div className="conv-stat-value" style={{ fontSize: '24px', fontWeight: 800, color, lineHeight: 1.1 }}>{s.value}</div>
            <div className="conv-stat-label" style={{ fontSize: '12px', color: 'var(--at-ink-2)', marginTop: '3px', fontWeight: active ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.label}
            </div>
          </button>
        )
      })}
    </div>
  )
}
