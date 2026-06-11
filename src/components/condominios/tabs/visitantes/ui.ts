// Etiquetas y colores del feature Visitantes (fase B, sin cambios de valores).
import type { TipoSolicitudMudanza } from '../../../../types'

export const PLATAFORMA_LABEL: Record<string, string> = {
  airbnb: 'Airbnb', booking: 'Booking.com', vrbo: 'VRBO', directo: 'Directo', otro: 'Otro',
}
export const PLATAFORMA_COLOR: Record<string, { bg: string; color: string }> = {
  airbnb:  { bg: 'var(--at-danger-tint)', color: '#e11d48' },
  booking: { bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  vrbo:    { bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  directo: { bg: 'var(--at-accent-tint-2)', color: 'var(--at-accent-hover)' },
  otro:    { bg: 'var(--at-surface-2)', color: 'var(--at-ink-2)' },
}

export const TIPO_MUDANZA_LABEL: Record<TipoSolicitudMudanza, string> = {
  nueva_mudanza:      'Nueva mudanza',
  ingreso_articulos:  'Ingreso de artículos',
  egreso_articulos:   'Egreso de artículos',
  mudanza_salida:     'Salida de mudanza',
}
