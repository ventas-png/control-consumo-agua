// Catálogos y estilos compartidos del feature Rutas (P1 #3, refactor de
// RutasSection). Mismo patrón que unidades/ui.ts y clientes/ui.ts.
import type { CSSProperties } from 'react'
import type { FrecuenciaRuta } from '../../types'

// ISO: 1 = lunes … 7 = domingo
export const DIAS_SEMANA: { iso: number; label: string }[] = [
  { iso: 1, label: 'L' }, { iso: 2, label: 'M' }, { iso: 3, label: 'M' },
  { iso: 4, label: 'J' }, { iso: 5, label: 'V' }, { iso: 6, label: 'S' }, { iso: 7, label: 'D' },
]

export const FRECUENCIAS: { value: FrecuenciaRuta; label: string }[] = [
  { value: 'unica', label: 'Única' },
  { value: 'diaria', label: 'Diaria' },
  { value: 'semanal', label: 'Semanal' },
  { value: 'quincenal', label: 'Quincenal' },
  { value: 'mensual', label: 'Mensual' },
  { value: 'fechas', label: 'Fechas específicas' },
]

export const ANTICIPACION_OPCIONES: { value: number; label: string }[] = [
  { value: 0, label: 'A la hora programada' },
  { value: 30, label: '30 minutos antes' },
  { value: 120, label: '2 horas antes' },
  { value: 1440, label: '1 día antes' },
  { value: 2880, label: '2 días antes' },
]

export const inputStyle: CSSProperties = {
  padding: '10px 14px',
  border: '2px solid var(--at-line)',
  borderRadius: '8px',
  fontSize: '14px',
  width: '100%',
  boxSizing: 'border-box',
}

export const labelStyle: CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--at-ink-2)',
  marginBottom: '4px',
  display: 'block',
}
