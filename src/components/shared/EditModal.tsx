import { useEffect, useRef, useCallback, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react'

export type EditModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'

const SIZE_WIDTHS: Record<EditModalSize, string> = {
  sm: '480px',
  md: '760px', // legacy default (mantener para retro-compat)
  lg: '880px',
  xl: '1100px',
  full: '95vw',
}

interface EditModalProps {
  title: string
  onClose: () => void
  children: ReactNode

  /** Subtítulo opcional bajo el título (texto descriptivo o metadata). */
  subtitle?: ReactNode

  /** Acciones en el header (ej. filtros, botón refresh) entre título y close. */
  headerActions?: ReactNode

  /**
   * Footer pegajoso con acciones (típicamente Cancelar/Guardar).
   * Se renderiza con `borderTop` y separado del body scrollable.
   */
  footer?: ReactNode

  /** Tamaño predefinido. Si se pasa `maxWidth`, este tiene prioridad. */
  size?: EditModalSize

  /** Override manual del ancho máximo (compatibilidad con uso previo). */
  maxWidth?: string

  /** Si true, body sin padding (para layouts custom: mapas, tablas full-width). */
  noPadding?: boolean

  /** Default true: cerrar al click en backdrop. */
  closeOnBackdropClick?: boolean

  /** Default true: cerrar al presionar Escape. */
  closeOnEscape?: boolean
}

export function EditModal({
  title,
  onClose,
  children,
  subtitle,
  headerActions,
  footer,
  size = 'md',
  maxWidth,
  noPadding = false,
  closeOnBackdropClick = true,
  closeOnEscape = true,
}: EditModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!closeOnEscape) return
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, closeOnEscape])

  // Focus trap: keep Tab cycling within the modal
  const handleFocusTrap = useCallback((e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab' || !dialogRef.current) return
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus() }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  }, [])

  const resolvedMaxWidth = maxWidth ?? SIZE_WIDTHS[size]

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={handleFocusTrap}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 'var(--at-space-3)',
      }}
      onClick={e => {
        if (!closeOnBackdropClick) return
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: 'var(--at-surface)',
          borderRadius: '16px',
          width: '100%',
          maxWidth: `min(${resolvedMaxWidth}, 95vw)`,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 60px rgba(0,0,0,0.2)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px 14px',
            borderBottom: '1px solid var(--at-line)',
            flexShrink: 0,
            gap: 'var(--at-space-3)',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--at-ink)' }}>
              {title}
            </h2>
            {subtitle && (
              <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: 'var(--at-space-1)' }}>
                {subtitle}
              </div>
            )}
          </div>
          {headerActions && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--at-space-2)', flexShrink: 0 }}>
              {headerActions}
            </div>
          )}
          <button
            onClick={onClose}
            aria-label="Cerrar modal"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--at-ink-3)',
              fontSize: '22px',
              lineHeight: 1,
              padding: 'var(--at-space-2)',
              minWidth: '44px',
              minHeight: '44px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
            title="Cerrar (Esc)"
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', padding: noPadding ? 0 : '20px', flex: 1 }}>
          {children}
        </div>

        {/* Sticky footer */}
        {footer && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 'var(--at-space-2)',
              padding: '14px 20px',
              borderTop: '1px solid var(--at-line)',
              flexShrink: 0,
              background: 'var(--at-surface)',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
