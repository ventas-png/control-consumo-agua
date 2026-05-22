import { type ReactNode, type CSSProperties } from 'react'
import { type Tone, TONE_VARS } from './statusTone'

interface Props {
  label: ReactNode
  value: ReactNode
  /** Tono semántico opcional: tiñe fondo, borde y valor. Sin tono → tile neutro. */
  tone?: Tone
  hint?: ReactNode
  icon?: ReactNode
  style?: CSSProperties
}

/**
 * Tile de métrica compacto y homologado — unifica las filas de KPIs dentro de
 * los tabs (tasa de cobro, unidades al día, deuda…) que cada uno construía con
 * fondos/colores hardcodeados. Para las tarjetas hero con gradiente usar `KpiCard`.
 */
export function StatTile({ label, value, tone, hint, icon, style }: Props) {
  const v = tone ? TONE_VARS[tone] : null
  return (
    <div
      style={{
        flex: '1 1 140px',
        minWidth: 140,
        background: v ? v.bg : 'var(--at-surface)',
        border: `1px solid ${v ? v.border : 'var(--at-line)'}`,
        borderRadius: 12,
        padding: '12px 14px',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: 4 }}>
        {icon}
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: v ? v.fg : 'var(--at-ink)', lineHeight: 1.1 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 3 }}>{hint}</div>}
    </div>
  )
}
