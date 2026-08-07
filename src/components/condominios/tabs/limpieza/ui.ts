// Estilos y etiquetas compartidas por las tres vistas del tab Limpieza
// (Áreas · Ruta del día · Novedades). Extraídos aquí para que las vistas no
// dupliquen paletas ni se desincronicen entre sí.
import type { CSSProperties } from 'react'
import type {
  FrecuenciaLimpieza,
  EstadoEjecucionLimpieza,
  PrioridadNovedadLimpieza,
  TurnoPersonal,
  CargoPersonal,
} from '../../../../types'

export const inputStyle: CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1.5px solid var(--at-line)',
  borderRadius: '7px', fontSize: '13px', boxSizing: 'border-box',
}

export const labelStyle: CSSProperties = {
  fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)',
  display: 'block', marginBottom: '3px',
}

export function btn(bg: string, color: string, extra: CSSProperties = {}): CSSProperties {
  return {
    padding: '8px 16px', background: bg, color, border: 'none', borderRadius: '8px',
    fontWeight: 600, cursor: 'pointer', fontSize: '13px', ...extra,
  }
}

export function chip(bg: string, color: string): CSSProperties {
  return {
    padding: '2px 8px', borderRadius: '99px', fontSize: '11px',
    fontWeight: 700, background: bg, color, whiteSpace: 'nowrap',
  }
}

export const FRECUENCIA_LABEL: Record<FrecuenciaLimpieza, { label: string; bg: string; color: string }> = {
  diaria:    { label: 'Diaria',    bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
  semanal:   { label: 'Semanal',   bg: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)' },
  quincenal: { label: 'Quincenal', bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  mensual:   { label: 'Mensual',   bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
}

export const TURNO_LABEL: Record<TurnoPersonal, { label: string; icon: string }> = {
  diurno:    { label: 'Diurno',    icon: '☀️' },
  nocturno:  { label: 'Nocturno',  icon: '🌙' },
  rotativo:  { label: 'Rotativo',  icon: '🔄' },
}

export const CARGO_LABEL: Record<CargoPersonal, string> = {
  conserje: 'Conserje',
  guardia: 'Guardia',
  jardinero: 'Jardinero',
  mantenimiento: 'Mantenimiento',
  administrador: 'Administrador',
  otro: 'Otro',
}

export const ESTADO_EJECUCION: Record<EstadoEjecucionLimpieza, {
  label: string; icon: string; bg: string; border: string; color: string
}> = {
  pendiente:   { label: 'Pendiente',   icon: '⏳', bg: 'var(--at-surface-2)',   border: 'var(--at-line)',           color: 'var(--at-ink-3)' },
  completada:  { label: 'Completada',  icon: '✅', bg: 'var(--at-success-tint)', border: 'var(--at-success-border)', color: 'var(--at-success)' },
  con_novedad: { label: 'Con novedad', icon: '⚠️', bg: 'var(--at-warning-tint)', border: 'var(--at-warning-border)', color: 'var(--at-warning-strong)' },
  omitida:     { label: 'Omitida',     icon: '⏭',  bg: 'var(--at-chip)',         border: 'var(--at-line)',           color: 'var(--at-ink-3)' },
}

export const PRIORIDAD_LABEL: Record<PrioridadNovedadLimpieza, { label: string; bg: string; color: string }> = {
  baja:  { label: 'Baja',  bg: 'var(--at-chip)',         color: 'var(--at-ink-3)' },
  media: { label: 'Media', bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  alta:  { label: 'Alta',  bg: 'var(--at-danger-tint)',  color: 'var(--at-danger)' },
}
