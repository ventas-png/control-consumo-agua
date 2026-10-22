import type { CSSProperties } from 'react'

// Estilos compartidos por las pestañas y ventanas de Servicio Energético.

/** Título + botón de la pestaña: en el teléfono el botón baja de línea en vez de apretar el título. */
export const encabezadoTab: CSSProperties = {
  marginBottom: '1rem',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '0.75rem',
}

export const etiqueta: CSSProperties = { display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }

export const campo: CSSProperties = {
  width: '100%',
  padding: '0.5rem',
  boxSizing: 'border-box',
  border: '1px solid var(--at-line-strong)',
  borderRadius: '4px',
  // Fondo explícito: con borde propio, el <select> de Chrome caía a gris.
  background: 'var(--at-surface)',
  color: 'var(--at-ink)',
  minWidth: 0,
}

/**
 * Rejilla de campos que pone tantas columnas como quepan (cada una de al menos
 * `min` px) y baja a una sola en el teléfono. Con `1fr 1fr` fijo, las fechas
 * se salían por la derecha de la ventana.
 */
export const rejilla = (min: number, gap = '0.75rem'): CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`,
  gap,
  // Si una etiqueta ocupa dos líneas, los campos de la fila siguen alineados.
  alignItems: 'end',
})

/** Botones de acción de una fila: en tarjeta (teléfono) quedan centrados al pie. */
export const accionesFila: CSSProperties = {
  display: 'inline-flex',
  gap: '0.5rem',
  flexWrap: 'wrap',
  justifyContent: 'center',
}
