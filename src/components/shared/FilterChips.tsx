import { type ReactNode } from 'react'

export interface FilterChipOption<T extends string> {
  value: T
  label: ReactNode
  /** Cuenta a mostrar entre paréntesis después del label. */
  count?: number
  /** Icono/emoji a la izquierda del label. */
  icon?: ReactNode
  /** Color del chip cuando está activo (default: var(--at-ink)). */
  color?: string
  /** Background del chip cuando está inactivo (default: var(--at-surface-2)). */
  bg?: string
}

interface SingleProps<T extends string> {
  options: FilterChipOption<T>[]
  value: T
  onChange: (value: T) => void
  multi?: false
  ariaLabel?: string
}

interface MultiProps<T extends string> {
  options: FilterChipOption<T>[]
  value: T[]
  onChange: (values: T[]) => void
  multi: true
  ariaLabel?: string
}

export type FilterChipsProps<T extends string> = SingleProps<T> | MultiProps<T>

/**
 * Fila de chips/pills toggleables para filtrar listas. Soporta single-select
 * (default) y multi-select. Centraliza el patrón que se repetía en ~15 tabs
 * con copy/paste del estilo (padding, borderRadius:20, fontWeight cuando
 * activo, color de fondo, etc).
 *
 * @example
 * <FilterChips
 *   options={[
 *     { value: 'todos', label: 'Todos', count: 42 },
 *     { value: 'activo', label: 'Activos', count: 30, color: 'var(--at-success)' },
 *     { value: 'inactivo', label: 'Inactivos', count: 12, color: 'var(--at-danger)' },
 *   ]}
 *   value={filtro}
 *   onChange={setFiltro}
 * />
 */
export function FilterChips<T extends string>(props: FilterChipsProps<T>) {
  const { options, ariaLabel } = props
  const isMulti = props.multi === true

  function isActive(opt: FilterChipOption<T>): boolean {
    if (isMulti) return (props as MultiProps<T>).value.includes(opt.value)
    return (props as SingleProps<T>).value === opt.value
  }

  function handleClick(opt: FilterChipOption<T>) {
    if (isMulti) {
      const current = (props as MultiProps<T>).value
      const next = current.includes(opt.value)
        ? current.filter(v => v !== opt.value)
        : [...current, opt.value]
      ;(props as MultiProps<T>).onChange(next)
    } else {
      ;(props as SingleProps<T>).onChange(opt.value)
    }
  }

  return (
    <div
      role={isMulti ? 'group' : 'radiogroup'}
      aria-label={ariaLabel ?? 'Filtros'}
      style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
    >
      {options.map(opt => {
        const active = isActive(opt)
        const baseColor = opt.color ?? 'var(--at-ink)'
        const baseBg = opt.bg ?? 'var(--at-surface-2)'
        return (
          <button
            key={opt.value}
            type="button"
            role={isMulti ? 'checkbox' : 'radio'}
            aria-checked={active}
            onClick={() => handleClick(opt)}
            style={{
              padding: '4px 12px',
              borderRadius: 20,
              border: `1px solid ${active ? baseColor : 'var(--at-line)'}`,
              fontSize: 11,
              fontWeight: active ? 700 : 500,
              cursor: 'pointer',
              background: active ? baseColor : baseBg,
              color: active ? '#fff' : baseColor,
              transition: 'background 0.12s, color 0.12s',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {opt.icon}
            <span>{opt.label}</span>
            {opt.count !== undefined && <span style={{ opacity: 0.85 }}>({opt.count})</span>}
          </button>
        )
      })}
    </div>
  )
}
