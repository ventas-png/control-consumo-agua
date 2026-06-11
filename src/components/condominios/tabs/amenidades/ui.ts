// Estilos y etiquetas del feature Amenidades (fase A del refactor del tab:
// extraídos del componente monolítico, sin cambios de valores).
import type { CSSProperties } from 'react'
import type { MotivoBloqueoAmenidad } from '../../../../types'

export const MOTIVO_LABEL: Record<MotivoBloqueoAmenidad, string> = {
  mantenimiento: 'Mantenimiento',
  limpieza: 'Limpieza profunda',
  evento_privado: 'Evento privado',
  reparacion: 'Reparación',
  otro: 'Otro',
}

export const ESTADO_COLORS: Record<string, { bg: string; color: string }> = {
  confirmada: { bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  pendiente:  { bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  cancelada:  { bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
}

export function pillStyle(bg: string, border: string, color: string): CSSProperties {
  return {
    padding: '3px 9px',
    borderRadius: 999,
    border: `1px solid ${border}`,
    background: bg,
    color,
    fontSize: 10.5,
    fontWeight: 700,
    whiteSpace: 'nowrap',
  }
}

export const CHIP_STYLES: Record<string, { bg: string; border: string; color: string }> = {
  confirmada:        { bg: 'var(--at-success-tint)', border: 'var(--at-success-border)', color: 'var(--at-success-strong)' },
  pendiente:         { bg: 'var(--at-warning-tint)', border: '#fcd34d', color: 'var(--at-warning-strong)' },
  cancelada:         { bg: 'var(--at-chip)', border: 'var(--at-line-strong)', color: 'var(--at-ink-2)' },
  no_show:           { bg: 'var(--at-danger-tint)', border: 'var(--at-danger-border)', color: 'var(--at-danger-strong)' },
  pagado:            { bg: 'var(--at-success-tint)', border: 'var(--at-success-border)', color: 'var(--at-success-strong)' },
  cobro_pendiente:   { bg: 'var(--at-warning-border)', border: '#fb923c', color: 'var(--at-warning-strong)' },
}

export function chipStyle(estado: string): CSSProperties {
  const c = CHIP_STYLES[estado] ?? CHIP_STYLES.cancelada
  return {
    padding: '3px 10px',
    borderRadius: 999,
    border: `1px solid ${c.border}`,
    background: c.bg,
    color: c.color,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.01em',
    whiteSpace: 'nowrap',
  }
}

export function btnAction(bg: string, border: string, color: string): CSSProperties {
  return {
    padding: '6px 12px',
    background: bg,
    color,
    border: `1px solid ${border}`,
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
    transition: 'transform 0.12s ease, filter 0.12s ease',
  }
}

export const btnHero: CSSProperties = {
  padding: '10px 18px',
  background: 'rgba(255,255,255,0.18)',
  color: 'white',
  border: '1.5px solid rgba(255,255,255,0.45)',
  borderRadius: 12,
  fontWeight: 700,
  cursor: 'pointer',
  fontSize: 13.5,
  backdropFilter: 'blur(6px)',
}

export const RESERVA_CAL_COLORS = [
  { bg: 'var(--at-primary-soft)', border: 'var(--at-accent-2)', color: 'var(--at-ink-deep)' },
  { bg: 'var(--at-success-tint)', border: 'var(--at-success-border)', color: 'var(--at-success-strong)' },
  { bg: 'var(--at-accent-tint)', border: 'var(--at-accent-soft)', color: '#4c1d95' },
  { bg: '#fce7f3', border: '#f9a8d4', color: '#9d174d' },
  { bg: 'var(--at-warning-tint)', border: '#fcd34d', color: 'var(--at-warning-strong)' },
]
