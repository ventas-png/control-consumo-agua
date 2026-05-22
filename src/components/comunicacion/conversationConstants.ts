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
