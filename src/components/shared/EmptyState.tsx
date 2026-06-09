import { type ReactNode, type CSSProperties } from 'react'

interface Props {
  /** Icono grande arriba (emoji, lucide, etc.). Default 📋. */
  icon?: ReactNode
  /** Título principal — "No hay X registrados". */
  title: string
  /** Texto secundario opcional con contexto. */
  description?: ReactNode
  /** CTA opcional (botón "Crear", "Importar", etc.). */
  action?: ReactNode
  /** Variante compacta para usar dentro de cards o áreas estrechas. */
  compact?: boolean
  style?: CSSProperties
}

/**
 * Estado vacío reusable — reemplaza patrones ad-hoc que repetían la misma
 * estructura (centrado, icono grande, texto secundario) en ~30 lugares.
 *
 *   <EmptyState
 *     icon="🐕"
 *     title="No hay mascotas registradas"
 *     description="Comienza añadiendo la primera mascota."
 *     action={<button onClick={open}>+ Nueva mascota</button>}
 *   />
 */
export function EmptyState({ icon = '📋', title, description, action, compact = false, style }: Props) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: compact ? 'var(--at-space-5) var(--at-space-4)' : 'var(--at-space-7) var(--at-space-4)',
        color: 'var(--at-ink-3)',
        ...style,
      }}
    >
      <div
        style={{
          fontSize: compact ? '32px' : '48px',
          marginBottom: compact ? 'var(--at-space-2)' : '14px',
          lineHeight: 1,
        }}
      >
        {icon}
      </div>
      <p
        style={{
          margin: 0,
          fontSize: compact ? '14px' : '16px',
          fontWeight: 600,
          color: 'var(--at-ink-2)',
        }}
      >
        {title}
      </p>
      {description && (
        <p
          style={{
            margin: '6px 0 0',
            fontSize: '13px',
            color: 'var(--at-ink-3)',
            maxWidth: '420px',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          {description}
        </p>
      )}
      {action && <div style={{ marginTop: compact ? 'var(--at-space-3)' : '20px' }}>{action}</div>}
    </div>
  )
}
