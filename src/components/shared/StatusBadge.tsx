import { type ReactNode, type CSSProperties } from 'react'
import { type Tone, TONE_VARS, statusTone } from './statusTone'

interface Props {
  /** Tono explícito. Si se omite, se deriva de `estado`. */
  tone?: Tone
  /** Estado de dominio (pagado, moroso, activo…) para derivar el tono y la etiqueta. */
  estado?: string | null
  /** Estilo sólido (fondo saturado + texto de contraste) en vez de suave. */
  solid?: boolean
  /** Punto indicador a la izquierda. */
  dot?: boolean
  size?: 'sm' | 'md'
  children?: ReactNode
  style?: CSSProperties
}

/**
 * Badge de estado homologado — reemplaza los cientos de
 * `<span style={{ background: '#dcfce7', color: '#16a34a', … }}>` repartidos por
 * los tabs. Usa tokens semánticos, por lo que respeta el modo claro/oscuro.
 *
 *   <StatusBadge estado={cuota.estado} />          // deriva tono + etiqueta
 *   <StatusBadge tone="danger" solid>3 vencidas</StatusBadge>
 */
export function StatusBadge({ tone, estado, solid = false, dot = false, size = 'sm', children, style }: Props) {
  const t: Tone = tone ?? statusTone(estado)
  const v = TONE_VARS[t]
  const label = children ?? (estado ? estado.replace(/_/g, ' ') : '')
  const skin: CSSProperties = solid
    ? { background: v.fg, color: 'var(--at-on-status)', border: '1px solid transparent' }
    : { background: v.bg, color: v.fg, border: `1px solid ${v.border}` }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: size === 'sm' ? '2px 8px' : '4px 10px',
        borderRadius: 999,
        fontSize: size === 'sm' ? 11 : 12,
        fontWeight: 700,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        textTransform: 'capitalize',
        ...skin,
        ...style,
      }}
    >
      {dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: solid ? 'var(--at-on-status)' : v.fg,
          }}
        />
      )}
      {label}
    </span>
  )
}
