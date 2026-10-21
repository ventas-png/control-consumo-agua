import type { ConversationCategory, ConversationPriority, ConversationStatus } from '../../types'

export const CATEGORY_LABELS: Record<ConversationCategory, string> = {
  general: 'General',
  pagos: 'Pagos',
  tecnico: 'Técnico',
  calidad: 'Calidad Agua',
  mantenimiento: 'Mantenimiento',
  finanzas: 'Finanzas',
  convivencia: 'Convivencia',
}

export const CATEGORY_ICONS: Record<ConversationCategory, string> = {
  general: '💬',
  pagos: '💳',
  tecnico: '🔧',
  calidad: '💧',
  mantenimiento: '🔨',
  finanzas: '💰',
  convivencia: '🤝',
}

export const PRIORITY_LABELS: Record<ConversationPriority, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  urgente: 'Urgente',
}

export const PRIORITY_COLORS: Record<ConversationPriority, string> = {
  baja: 'var(--at-success)',
  media: 'var(--at-warning)',
  alta: 'var(--at-danger)',
  urgente: 'var(--at-accent-hover)',
}

export const STATUS_LABELS: Record<ConversationStatus, string> = {
  abierta: 'Abierta',
  en_progreso: 'En Progreso',
  esperando_cliente: 'Esperando Cliente',
  resuelta: 'Resuelta',
  cerrada: 'Cerrada',
}

/** Los mismos estados, contados desde el lado del cliente (portal). */
export const STATUS_LABELS_CLIENTE: Record<ConversationStatus, string> = {
  abierta: 'Abierta',
  en_progreso: 'En progreso',
  esperando_cliente: 'Esperando tu respuesta',
  resuelta: 'Resuelta',
  cerrada: 'Cerrada',
}

export const STATUS_COLORS: Record<ConversationStatus, string> = {
  abierta: 'var(--at-info)',
  en_progreso: 'var(--at-warning)',
  esperando_cliente: 'var(--at-accent)',
  resuelta: 'var(--at-success)',
  cerrada: 'var(--at-ink-3)',
}

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  operator: 'Operador',
  collector: 'Gestor de Cobros',
  viewer: 'Visualizador',
  administrador_general: 'Administrador General',
  junta_directiva: 'Junta Directiva',
  finanzas: 'Finanzas / Contador',
  operaciones: 'Operaciones',
  seguridad: 'Seguridad',
  comunidad: 'Comunidad',
  recepcion: 'Recepción',
  visualizador: 'Visualizador',
}

/**
 * Fondo suave a partir de un color de los mapas de arriba. Los colores son
 * `var(--at-*)`, así que el viejo `color + '18'` (alfa hex) producía
 * `var(--at-info)18`: CSS inválido, y los badges salían sin fondo.
 * `color-mix` sí acepta variables y respeta el modo oscuro.
 */
export function tint(color: string, pct = 14): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`
}

/** Iniciales para el avatar de una fila ("Carlos García" → "CG"). */
export function initials(name?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** Clave de día local para agrupar mensajes (solo se compara, no se muestra). */
export function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** Etiqueta del separador de día en el chat: Hoy / Ayer / 14 de octubre. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000)
  if (diffDays === 0) return 'Hoy'
  if (diffDays === 1) return 'Ayer'
  return d.toLocaleDateString('es-GT', {
    day: 'numeric', month: 'long',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  })
}

export function getFileIcon(mimeType?: string | null): string {
  if (!mimeType) return '📎'
  if (mimeType === 'application/pdf') return '📄'
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return '📊'
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝'
  if (mimeType.startsWith('image/')) return '🖼️'
  return '📎'
}

export function formatBytes(bytes?: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Ahora'
  if (diffMin < 60) return `Hace ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `Hace ${diffH}h`
  return d.toLocaleDateString('es-GT', { day: '2-digit', month: 'short' })
}
