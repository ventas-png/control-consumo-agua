import { type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'success'
  | 'warning'
  | 'outline-primary'
  | 'outline-danger'
  | 'gradient-primary'
  | 'gradient-accent'

export type ButtonSize = 'sm' | 'md' | 'lg'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  /** Muestra spinner y deshabilita el botón. */
  loading?: boolean
  /** Texto a mostrar cuando loading=true. Default mantiene children. */
  loadingText?: ReactNode
  /** Icono a la izquierda del texto. */
  iconLeft?: ReactNode
  /** Icono a la derecha del texto. */
  iconRight?: ReactNode
  /** `type` del button. Default 'button' (evita submits accidentales). */
  type?: 'button' | 'submit' | 'reset'
}

const VARIANTS: Record<ButtonVariant, CSSProperties> = {
  primary:          { background: 'var(--at-primary)', color: '#fff', border: '1px solid var(--at-primary)' },
  secondary:        { background: 'var(--at-surface)', color: 'var(--at-ink)', border: '1px solid var(--at-line-strong)' },
  ghost:            { background: 'transparent', color: 'var(--at-ink-2)', border: '1px solid transparent' },
  danger:           { background: 'var(--at-danger)', color: 'var(--at-on-status)', border: '1px solid transparent' },
  success:          { background: 'var(--at-success)', color: 'var(--at-on-status)', border: '1px solid transparent' },
  warning:          { background: 'var(--at-warning)', color: 'var(--at-on-status)', border: '1px solid transparent' },
  'outline-primary':{ background: 'transparent', color: 'var(--at-primary)', border: '1.5px solid var(--at-primary)' },
  'outline-danger': { background: 'transparent', color: 'var(--at-danger)', border: '1.5px solid var(--at-danger)' },
  'gradient-primary': {
    background: 'linear-gradient(135deg, var(--at-primary), var(--at-primary-hover))',
    color: '#fff', border: 'none',
  },
  'gradient-accent': {
    background: 'linear-gradient(135deg, var(--at-accent), var(--at-accent-hover))',
    color: '#fff', border: 'none',
  },
}

const SIZE_STYLES: Record<ButtonSize, { padding: string; fontSize: number }> = {
  sm: { padding: '6px 12px',  fontSize: 13 },
  md: { padding: '9px 16px',  fontSize: 14 },
  lg: { padding: '11px 22px', fontSize: 15 },
}

/**
 * Botón homologado con variantes de marca + soporte para loading/icons.
 * Centraliza el estilo (radio, padding, hover, transitions) que cada tab
 * reimplementaba con hex/gradients hardcodeados.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  loadingText,
  iconLeft,
  iconRight,
  className,
  style,
  disabled,
  type = 'button',
  children,
  ...rest
}: Props) {
  const isDisabled = disabled || loading
  const sz = SIZE_STYLES[size]
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={['at-btn', className].filter(Boolean).join(' ')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        fontFamily: 'inherit',
        fontWeight: 600,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        borderRadius: 9,
        padding: sz.padding,
        fontSize: sz.fontSize,
        width: block ? '100%' : undefined,
        opacity: isDisabled ? 0.55 : 1,
        transition: 'opacity 0.15s, transform 0.05s',
        ...VARIANTS[variant],
        ...style,
      }}
      {...rest}
    >
      {loading && <Spinner />}
      {!loading && iconLeft}
      {loading ? (loadingText ?? children) : children}
      {!loading && iconRight}
    </button>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: 12,
        height: 12,
        border: '2px solid currentColor',
        borderTopColor: 'transparent',
        borderRadius: '50%',
        animation: 'shared-spin 0.7s linear infinite',
      }}
    />
  )
}
