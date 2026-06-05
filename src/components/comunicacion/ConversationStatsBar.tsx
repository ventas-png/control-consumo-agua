// Stats rápidas del centro de comunicación. Extraído de ComunicacionSection (com:N6).
export interface ConversationStats {
  abiertas: number
  en_progreso: number
  esperando: number
  resueltas: number
}

export function ConversationStatsBar({ stats }: { stats: ConversationStats }) {
  const cards = [
    { label: 'Abiertas', value: stats.abiertas, color: 'var(--at-primary-2)' },
    { label: 'En Progreso', value: stats.en_progreso, color: 'var(--at-warning)' },
    { label: 'Esperando', value: stats.esperando, color: 'var(--at-accent)' },
    { label: 'Resueltas', value: stats.resueltas, color: 'var(--at-success)' },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px' }}>
      {cards.map(s => (
        <div key={s.label} style={{
          background: 'var(--at-surface)',
          border: '1px solid var(--at-line)',
          borderRadius: '10px',
          padding: '12px 14px',
          borderTop: `3px solid ${s.color}`,
        }}>
          <div style={{ fontSize: '22px', fontWeight: 700, color: s.color }}>{s.value}</div>
          <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{s.label}</div>
        </div>
      ))}
    </div>
  )
}
