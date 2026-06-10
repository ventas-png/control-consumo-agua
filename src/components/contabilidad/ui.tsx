// Estilos y micro-componentes compartidos del módulo Contabilidad.
import type { CSSProperties, ReactNode } from 'react'

export function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--at-ink-soft)' }}>
      {label}
      {children}
    </label>
  )
}

export const input: CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--at-line)',
  borderRadius: 8,
  fontSize: 13,
  background: 'var(--at-surface)',
  color: 'var(--at-ink)',
}

export const btnPrimario: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--at-accent)',
  color: '#fff',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
}

export const btnSecundario: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid var(--at-line)',
  background: 'var(--at-surface)',
  color: 'var(--at-ink)',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
}

export const btnLink: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--at-accent)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  padding: 0,
}

export const btnPeligro: CSSProperties = {
  ...btnSecundario,
  color: 'var(--at-danger)',
  borderColor: 'var(--at-danger)',
}
