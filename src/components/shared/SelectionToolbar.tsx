import { type ReactNode, type CSSProperties } from 'react'

// ============================================================================
// SelectionToolbar — Toolbar sticky para bulk actions
// ============================================================================
// Se renderiza condicionalmente cuando hay items seleccionados. Pinneada a
// bottom (default) o top via prop position. Actions son configurables — el
// caller pasa los handlers ya bound al state.
//
// A11y:
//   - role="toolbar" + aria-label
//   - Cada action tiene aria-label propio
//   - Tab navegacion natural via flex order
//
// Diseño:
//   - Sticky con z-index alto para sobreponerse a tablas con sticky headers
//   - Backdrop blur leve para que la tabla detras sea legible pero atenuada
//   - Botón "Limpiar selección" siempre presente a la derecha
//   - Variants por action: danger (rojo), default (gris)

export interface BulkAction {
  /** Identificador único (no se muestra al usuario) */
  id: string
  /** Etiqueta del botón */
  label: string
  /** Icono emoji o character (visual hint) */
  icon?: string
  /** Variante visual */
  variant?: 'default' | 'danger' | 'primary'
  /** Click handler — el caller usa los selectedItems del hook */
  onClick: () => void | Promise<void>
  /** Disabled si action no aplica al subset (ej: items de estados mixtos) */
  disabled?: boolean
  /** Tooltip cuando disabled */
  disabledReason?: string
}

interface Props {
  /** Cuántos items hay seleccionados */
  count: number
  /** Acciones disponibles */
  actions: BulkAction[]
  /** Callback de limpiar selección */
  onClear: () => void
  /** Posición sticky — default 'bottom' */
  position?: 'top' | 'bottom'
  /** Singular/plural de la entidad — default "elementos" */
  entityLabel?: { one: string; many: string }
  /** Contenido adicional a la izquierda del count (ej: "Total: $1,200") */
  leftSlot?: ReactNode
}

export function SelectionToolbar({
  count, actions, onClear,
  position = 'bottom',
  entityLabel = { one: 'elemento', many: 'elementos' },
  leftSlot,
}: Props) {
  if (count === 0) return null

  const label = count === 1 ? entityLabel.one : entityLabel.many

  return (
    <div
      role="toolbar"
      aria-label={`${count} ${label} seleccionado${count === 1 ? '' : 's'}`}
      style={position === 'bottom' ? bottomStyle : topStyle}
    >
      <div style={countStyle}>
        <strong>{count}</strong> <span style={{ color: 'var(--at-ink-3)' }}>{label}</span>
        {leftSlot && <span style={{ marginLeft: 12, color: 'var(--at-ink-3)' }}>{leftSlot}</span>}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {actions.map(a => (
          <button
            key={a.id}
            type="button"
            onClick={() => { void a.onClick() }}
            disabled={a.disabled}
            aria-label={a.label}
            title={a.disabled ? a.disabledReason : undefined}
            style={actionBtnStyle(a.variant ?? 'default', !!a.disabled)}
          >
            {a.icon && <span aria-hidden="true">{a.icon}</span>}
            <span>{a.label}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onClear}
        aria-label="Limpiar selección"
        style={clearBtnStyle}
      >
        ✕ Limpiar
      </button>
    </div>
  )
}

// ───── Styles ─────────────────────────────────────────────────────────────

const baseStyle: CSSProperties = {
  position: 'sticky',
  left: 0, right: 0,
  zIndex: 50,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
  padding: '10px 14px',
  background: 'var(--at-surface)',
  borderRadius: 10,
  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
  border: '1px solid var(--at-line)',
  backdropFilter: 'blur(8px)',
}

const bottomStyle: CSSProperties = {
  ...baseStyle,
  bottom: 16,
  marginTop: 12,
}

const topStyle: CSSProperties = {
  ...baseStyle,
  top: 16,
  marginBottom: 12,
}

const countStyle: CSSProperties = {
  flex: 1,
  fontSize: 13,
  color: 'var(--at-ink)',
  minWidth: 120,
}

function actionBtnStyle(variant: 'default' | 'danger' | 'primary', disabled: boolean): CSSProperties {
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 14px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    border: '1px solid transparent',
  }
  if (variant === 'danger') {
    return { ...base, background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1px solid var(--at-danger-border, var(--at-danger))' }
  }
  if (variant === 'primary') {
    return { ...base, background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))', color: 'white' }
  }
  return { ...base, background: 'var(--at-surface-2)', color: 'var(--at-ink-2)', border: '1px solid var(--at-line-strong)' }
}

const clearBtnStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--at-ink-3)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  padding: '7px 10px',
}
