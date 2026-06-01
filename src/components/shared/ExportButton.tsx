import { useState, useRef, useEffect, type CSSProperties } from 'react'
import { exportData, type ExportFormat, type ExportColumn } from '../../lib/exportData'
import { notify } from './Dialog'

// ============================================================================
// ExportButton — F4.5.2: dropdown con 3 formatos (XLSX/CSV/PDF)
// ============================================================================
// Componente reusable. Recibe data + columns y se encarga de:
//   - Renderizar boton "Exportar" con dropdown
//   - Disparar exportData() en el formato elegido
//   - notify de exito/error
//   - Disabled si data esta vacio
//
// A11y: button con aria-haspopup, menu con role=menu, items con role=menuitem.

interface Props<T> {
  data: T[]
  columns: ExportColumn<T>[]
  filename: string
  title?: string
  subtitle?: string
  /** Etiqueta del boton — default "Exportar" */
  label?: string
  /** Variante visual */
  variant?: 'primary' | 'secondary'
}

const FORMATS: Array<{ id: ExportFormat; label: string; icon: string }> = [
  { id: 'xlsx', label: 'Excel (.xlsx)', icon: '📊' },
  { id: 'csv',  label: 'CSV (.csv)',     icon: '📄' },
  { id: 'pdf',  label: 'PDF (.pdf)',     icon: '📑' },
]

export function ExportButton<T>({ data, columns, filename, title, subtitle, label = 'Exportar', variant = 'secondary' }: Props<T>) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Click outside cierra el menu
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onEscape(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  async function handleExport(format: ExportFormat) {
    setOpen(false)
    setBusy(format)
    try {
      await exportData(format, { data, columns, filename, title, subtitle })
      notify({ variant: 'success', title: 'Exportado', text: `${filename}.${format}`, duration: 1500 })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      notify({ variant: 'error', title: 'Error al exportar', text: msg })
    } finally {
      setBusy(null)
    }
  }

  const disabled = data.length === 0 || busy !== null

  return (
    <div ref={menuRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={data.length === 0 ? 'Sin datos para exportar' : undefined}
        style={variant === 'primary' ? primaryBtnStyle(disabled) : secondaryBtnStyle(disabled)}
      >
        {busy ? '…' : '📤'} {busy ?? label}
        <span aria-hidden="true" style={{ fontSize: '9px', marginLeft: '2px' }}>▾</span>
      </button>
      {open && (
        <div role="menu" style={menuStyle}>
          {FORMATS.map(f => (
            <button
              key={f.id}
              role="menuitem"
              type="button"
              onClick={() => { void handleExport(f.id) }}
              style={menuItemStyle}
            >
              <span aria-hidden="true">{f.icon}</span>
              <span>{f.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function primaryBtnStyle(disabled: boolean): CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    padding: '9px 16px', borderRadius: '8px', border: 'none',
    background: disabled ? 'var(--at-ink-2)' : 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
    color: disabled ? 'var(--at-ink-3)' : 'white',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '13px', fontWeight: 600,
  }
}

function secondaryBtnStyle(disabled: boolean): CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    padding: '9px 14px', borderRadius: '8px',
    border: '1px solid var(--at-line-strong)',
    background: 'var(--at-surface-2)', color: 'var(--at-ink-2)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '13px', fontWeight: 600,
    opacity: disabled ? 0.55 : 1,
  }
}

const menuStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  right: 0,
  background: 'var(--at-surface)',
  border: '1px solid var(--at-line)',
  borderRadius: '8px',
  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
  padding: '4px',
  minWidth: '180px',
  zIndex: 100,
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
}

const menuItemStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '10px',
  padding: '8px 12px', borderRadius: '6px',
  border: 'none', background: 'transparent',
  color: 'var(--at-ink-2)', fontSize: '13px', fontWeight: 500,
  cursor: 'pointer', textAlign: 'left',
  width: '100%',
}
