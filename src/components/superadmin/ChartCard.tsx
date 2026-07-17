import { type ReactNode } from 'react'

// ============================================================================
// ChartCard — card de gráfica del panel superadmin (extraída de
// SuperAdminDashboardTab para poder componer varias con acciones propias).
// ============================================================================
// Superficie clara con estados de carga/vacío y cuerpo de altura fija (las
// gráficas usan maintainAspectRatio:false y necesitan un contenedor con alto).

interface Props {
  title: string
  subtitle?: string
  /** Controles a la derecha del título (p. ej. FilterChips de rango). */
  actions?: ReactNode
  loading: boolean
  /** Refetch en curso con datos previos visibles (keepPreviousData): atenúa el
   *  cuerpo y lo anuncia para no presentar el rango viejo como el nuevo. */
  refreshing?: boolean
  empty: boolean
  emptyText: string
  /** Nota al pie del canvas (aclaraciones de la serie). */
  footnote?: string
  children: ReactNode
}

export function ChartCard({ title, subtitle, actions, loading, refreshing = false, empty, emptyText, footnote, children }: Props) {
  return (
    <div style={{
      background: 'var(--at-surface)',
      borderRadius: '14px',
      padding: '18px 20px',
      border: '1px solid var(--at-line)',
      boxShadow: 'var(--at-elevation-2)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--at-ink)' }}>{title}</span>
            {refreshing && (
              <span role="status" style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>actualizando…</span>
            )}
          </div>
          {subtitle && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{subtitle}</div>}
        </div>
        {actions}
      </div>
      {loading ? (
        <div style={{ height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--at-ink-3)', fontSize: '13px' }}>
          Cargando…
        </div>
      ) : empty ? (
        <div style={{ height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--at-ink-3)', fontSize: '13px', textAlign: 'center', padding: '0 20px' }}>
          {emptyText}
        </div>
      ) : (
        <>
          <div style={{ height: '220px', opacity: refreshing ? 0.55 : 1, transition: 'opacity var(--at-motion-base)' }}>
            {children}
          </div>
          {footnote && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '8px' }}>{footnote}</div>}
        </>
      )}
    </div>
  )
}
