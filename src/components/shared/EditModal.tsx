import { useEffect, useRef, useCallback, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react'

interface EditModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  maxWidth?: string
}

export function EditModal({ title, onClose, children, maxWidth = '760px' }: EditModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

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
        padding: '12px',
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          width: '100%',
          maxWidth: `min(${maxWidth}, 95vw)`,
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
            borderBottom: '1px solid #E1DDD0',
            flexShrink: 0,
          }}
        >
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#15291F' }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Cerrar modal"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#7E9389',
              fontSize: '22px',
              lineHeight: 1,
              padding: '8px',
              minWidth: '44px',
              minHeight: '44px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Cerrar (Esc)"
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', padding: '20px', flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  )
}
