import type { CSSProperties } from 'react'

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

interface ToneVars {
  /** Color de primer plano / texto e iconos sobre fondo claro. */
  fg: string
  /** Fondo suave (tint) para badges y tarjetas. */
  bg: string
  /** Borde tenue a juego con el tint. */
  border: string
  /** Variante de texto más oscura/fuerte para títulos sobre tint. */
  strong: string
}

export const TONE_VARS: Record<Tone, ToneVars> = {
  success: { fg: 'var(--at-success)', bg: 'var(--at-success-tint)', border: 'var(--at-success-border)', strong: 'var(--at-success-strong)' },
  warning: { fg: 'var(--at-warning)', bg: 'var(--at-warning-tint)', border: 'var(--at-warning-border)', strong: 'var(--at-warning-strong)' },
  danger:  { fg: 'var(--at-danger)',  bg: 'var(--at-danger-tint)',  border: 'var(--at-danger-border)',  strong: 'var(--at-danger-strong)' },
  info:    { fg: 'var(--at-info)',    bg: 'var(--at-info-tint)',    border: 'var(--at-info-border)',    strong: 'var(--at-info-strong)' },
  neutral: { fg: 'var(--at-ink-3)',   bg: 'var(--at-chip)',         border: 'var(--at-line)',           strong: 'var(--at-ink-2)' },
}

const TONE_BY_STATUS: Record<string, Tone> = {
  // Pagos / cuotas
  pagado: 'success', pagada: 'success', cobrado: 'success', cobrada: 'success', conciliado: 'success', aprobado: 'success', aprobada: 'success',
  pendiente: 'warning', parcial: 'warning', en_proceso: 'warning', proceso: 'warning', revision: 'warning', en_revision: 'warning',
  moroso: 'danger', morosa: 'danger', vencido: 'danger', vencida: 'danger', rechazado: 'danger', rechazada: 'danger', cancelado: 'danger', cancelada: 'danger', anulado: 'danger', anulada: 'danger',
  // Estado genérico activo / inactivo / vigencia
  activo: 'success', activa: 'success', vigente: 'success', habilitado: 'success',
  inactivo: 'neutral', inactiva: 'neutral', sin_cuota: 'neutral', derogado: 'neutral', deshabilitado: 'neutral',
}

/** Deriva un tono semántico a partir de un estado de dominio. */
export function statusTone(estado?: string | null): Tone {
  if (!estado) return 'neutral'
  return TONE_BY_STATUS[estado.toLowerCase().trim()] ?? 'neutral'
}

/** Estilo suave (tint + texto a tono + borde) para un tono dado. */
export function softToneStyle(tone: Tone): CSSProperties {
  const v = TONE_VARS[tone]
  return { background: v.bg, color: v.fg, border: `1px solid ${v.border}` }
}
