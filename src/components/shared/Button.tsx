import { type ButtonHTMLAttributes, type CSSProperties } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  block?: boolean
}

const VARIANTS: Record<Variant, CSSProperties> = {
  primary:   { background: 'var(--at-primary)', color: '#fff', border: '1px solid var(--at-primary)' },
  secondary: { background: 'var(--at-surface)', color: 'var(--at-ink)', border: '1px solid var(--at-line-strong)' },
  ghost:     { background: 'transparent', color: 'var(--at-ink-2)', border: '1px solid transparent' },
  danger:    { background: 'var(--at-danger)', color: 'var(--at-on-status)', border: '1px solid transparent' },
}

/**
 * Botón homologado con variantes de marca. Centraliza el estilo (radio, padding,
 * hover) que cada tab reimplementaba con hex hardcodeado.
 */
export function Button({ variant = 'primary', size = 'md', block = false, className, style, disabled, ...rest }: Props) {
  return (
    <button
      disabled={disabled}
      className={['at-btn', className].filter(Boolean).join(' ')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        fontFamily: 'inherit',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        borderRadius: 9,
        padding: size === 'sm' ? '6px 12px' : '9px 16px',
        fontSize: size === 'sm' ? 13 : 14,
        width: block ? '100%' : undefined,
        opacity: disabled ? 0.55 : 1,
        ...VARIANTS[variant],
        ...style,
      }}
      {...rest}
    />
  )
}
