// Colores de estado del portal del residente (sin cambios de valores).

export const ESTADO_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  pendiente: { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', label: 'Pendiente' },
  pagado: { bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)', label: 'Pagado' },
  mora: { bg: 'var(--at-danger-tint)', color: 'var(--at-danger-strong)', label: 'Mora' },
}
