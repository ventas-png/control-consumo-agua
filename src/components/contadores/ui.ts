// Catálogos y estilos compartidos del feature Contadores (P1 #3, refactor de
// ContadoresSection). Mismo patrón que unidades/ui.ts y rutas/ui.ts.
import type { CSSProperties } from 'react'
import type { TipoAgua } from '../../types'

export const TIPOS_AGUA: { value: TipoAgua; label: string }[] = [
  { value: 'potable', label: 'Potable' },
  { value: 'rehuso', label: 'Rehúso' },
  { value: 'piscina', label: 'Piscina' },
  { value: 'desalinada', label: 'Desalinada' },
  { value: 'riego', label: 'Riego' },
  { value: 'jacuzzi', label: 'Jacuzzi' },
  { value: 'consumo_humano', label: 'Consumo Humano' },
  { value: 'desmineralizada', label: 'Desmineralizada' },
  { value: 'residuales_tratadas', label: 'Residuales Tratadas' },
]

export const TIPO_COLORES: Record<TipoAgua, { bg: string; color: string }> = {
  potable:             { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
  rehuso:              { bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)' },
  piscina:             { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
  desalinada:          { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  riego:               { bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)' },
  jacuzzi:             { bg: 'var(--at-accent-tint)', color: 'var(--at-accent-darker)' },
  consumo_humano:      { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  desmineralizada:     { bg: '#fce7f3', color: '#9d174d' },
  residuales_tratadas: { bg: 'var(--at-chip)', color: 'var(--at-ink-2)' },
}

export const MEDIDAS_CONTADOR = [
  '1/2"  (½") — 15 mm',
  '3/4"  (¾") — 20 mm',
  '1"    — 25 mm',
  '1 1/4" — 32 mm',
  '1 1/2" — 40 mm',
  '2"    — 50 mm',
  '2 1/2" — 63 mm',
  '3"    — 75 mm',
  '4"    — 110 mm',
  '5"    — 140 mm',
  '6"    — 160 mm',
]

export const MATERIALES_CONTADOR = [
  'Bronce',
  'Latón',
  'Hierro fundido',
  'Hierro galvanizado',
  'Acero inoxidable',
  'Cobre',
  'Plástico (PVC)',
  'Plástico (polipropileno)',
  'Plástico (nylon reforzado)',
  'Composite (plástico/metal)',
]

export const TIPOS_CONTADOR = ['Analógico velocimétrico', 'Analógico volumétrico', 'Digital', 'Ultrasónico', 'Electromagnético', 'Otro']
export const OPCIONES_SIN = ['Sí', 'No', 'N/A']
export const OPCIONES_SI_NO = ['Sí', 'No']
export const TIPOS_LLAVE = ['Compuerta', 'Bola', 'Mariposa', 'Globo', 'Aguja', 'Otra']

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

export const tipoLabel = (value: TipoAgua) =>
  TIPOS_AGUA.find(t => t.value === value)?.label ?? value
