// Catálogos visuales del feature Seguridad (P1 #3, refactor de SeguridadTab).
// Mismo patrón que tabs/amenidades/ui.ts y tabs/visitantes.
import type { EstadoRonda, EstadoVisitaControl, PrioridadNovedad, TipoNovedad } from '../../../../types'

export const PLATAFORMA_LABEL: Record<string, string> = {
  airbnb: 'Airbnb', booking: 'Booking.com', vrbo: 'VRBO', directo: 'Directo', otro: 'Otro',
}

export const PLATAFORMA_COLOR: Record<string, { bg: string; color: string }> = {
  airbnb:   { bg: 'var(--at-danger-tint)', color: '#e11d48' },
  booking:  { bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  vrbo:     { bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  directo:  { bg: 'var(--at-accent-tint-2)', color: 'var(--at-accent-hover)' },
  otro:     { bg: 'var(--at-surface-2)', color: 'var(--at-ink-2)' },
}

export const PRIORIDAD_CONFIG: Record<PrioridadNovedad, { label: string; bg: string; color: string }> = {
  normal:  { label: 'Normal',  bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  alta:    { label: 'Alta',    bg: 'var(--at-warning-tint)', color: 'var(--at-warning)' },
  critica: { label: 'Crítica', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
}

export const TIPO_NOVEDAD_CONFIG: Record<TipoNovedad, { label: string; icon: string }> = {
  incidente:   { label: 'Incidente',   icon: '🚨' },
  observacion: { label: 'Observación', icon: '👁' },
  alarma:      { label: 'Alarma',      icon: '🔔' },
  acceso:      { label: 'Acceso',      icon: '🚪' },
  otro:        { label: 'Otro',        icon: '📋' },
}

export const ESTADO_RONDA: Record<EstadoRonda, { label: string; bg: string; color: string }> = {
  en_curso:   { label: 'En curso',   bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  completada: { label: 'Completada', bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  incompleta: { label: 'Incompleta', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
}

export const VISITA_CONFIG: Record<EstadoVisitaControl, { label: string; icon: string; bg: string; color: string }> = {
  pendiente: { label: 'Pendiente', icon: '⏳', bg: 'var(--at-surface-2)',  color: 'var(--at-ink-3)' },
  ok:        { label: 'OK',        icon: '✅', bg: 'var(--at-success-tint)',  color: 'var(--at-success)' },
  novedad:   { label: 'Novedad',   icon: '⚠️', bg: 'var(--at-warning-tint)',  color: 'var(--at-warning)' },
  omitido:   { label: 'Omitido',   icon: '⏭',  bg: 'var(--at-accent-tint-2)',  color: 'var(--at-accent-hover)' },
}

/** Color de acento por prioridad (franja y header del detalle de novedad). */
export function accentPrioridad(prioridad: PrioridadNovedad): string {
  if (prioridad === 'critica') return 'var(--at-danger)'
  if (prioridad === 'alta') return 'var(--at-warning)'
  return 'var(--at-success)'
}
