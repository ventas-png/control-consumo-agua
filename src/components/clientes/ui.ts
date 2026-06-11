// Estilos y etiquetas del feature Clientes (extraídos sin cambios de valores).
import type { CSSProperties } from 'react'

export const inputStyle: CSSProperties = {
  padding: '10px 14px',
  border: '2px solid var(--at-line)',
  borderRadius: '8px',
  fontSize: '14px',
  width: '100%',
  boxSizing: 'border-box',
  outline: 'none',
}
export const labelStyle: CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--at-ink-2)',
  marginBottom: '5px',
  display: 'block',
}
export const sectionHeaderStyle: CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--at-ink-3)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '10px',
}

export const fieldLabelMap: Record<string, string> = {
  cui_dui: 'CUI / DUI',
  fecha_nacimiento: 'Fecha de Nacimiento',
  email: 'Correo Electrónico',
}
