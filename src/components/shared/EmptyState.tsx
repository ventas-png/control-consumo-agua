import { type ReactNode, type CSSProperties } from 'react'

interface Props {
  /** Icono grande arriba (emoji o <Icon/> de línea). Default 📋. */
  icon?: ReactNode
  /** Título principal — "No hay X registrados". */
  title: string
  /** Texto secundario opcional con contexto. */
  description?: ReactNode
  /** CTA opcional (botón "Crear", "Importar", etc.). */
  action?: ReactNode
  /** Variante compacta para usar dentro de cards o áreas estrechas. */
  compact?: boolean
  /**
   * Tono según audiencia:
   * - 'admin' (default): eficiente, orientado a tarea (como hasta ahora).
   * - 'resident': cálido/consumer — icono en medallón de marca, más respiro.
   */
  audience?: 'admin' | 'resident'
  style?: CSSProperties
}

/**
 * Estado vacío reusable — reemplaza patrones ad-hoc que repetían la misma
 * estructura (centrado, icono grande, texto secundario) en ~30 lugares.
 * Patrón "dos partes instrucción, una de deleite": icono + título orientado a
 * acción + descripción + CTA real.
 *
 *   <EmptyState
 *     icon={<Icon name="droplet" size={26} />}
 *     title="No hay lecturas registradas"
 *     description="Comienza registrando la primera lectura del período."
 *     action={<Button>+ Nueva lectura</Button>}
 *   />
 */
export function EmptyState({ icon = '📋', title, description, action, compact = false, audience = 'admin', style }: Props) {
  const isResident = audience === 'resident'
  return (
    <div
      style={{
        textAlign: 'center',
        padding: compact ? 'var(--at-space-5) var(--at-space-4)' : 'var(--at-space-7) var(--at-space-4)',
        color: 'var(--at-ink-3)',
        ...style,
      }}
    >
      {isResident && !compact ? (
        // Medallón de marca: tiñe los iconos SVG (currentColor) en --at-primary.
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'var(--at-primary-tint)',
            color: 'var(--at-primary)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '30px',
            lineHeight: 1,
            marginBottom: 'var(--at-space-4)',
          }}
        >
          {icon}
        </div>
      ) : (
        <div
          style={{
            fontSize: compact ? '32px' : '48px',
            marginBottom: compact ? 'var(--at-space-2)' : '14px',
            lineHeight: 1,
            color: 'var(--at-ink-3)',
          }}
        >
          {icon}
        </div>
      )}
      <p
        style={{
          margin: 0,
          fontSize: compact ? '14px' : isResident ? '17px' : '16px',
          fontWeight: isResident ? 700 : 600,
          color: isResident ? 'var(--at-ink)' : 'var(--at-ink-2)',
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
