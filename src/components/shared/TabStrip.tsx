import { useEffect, useRef, type ReactNode } from 'react'

export interface TabStripItem<T extends string> {
  id: T
  label: string
  /** Emoji/icono opcional a la izquierda del label. */
  icon?: ReactNode
}

interface Props<T extends string> {
  items: TabStripItem<T>[]
  value: T
  onChange: (id: T) => void
  /** Etiqueta del tablist para lectores de pantalla. */
  ariaLabel: string
  /** Margen inferior del contenedor (default: 0, como en Condominios). */
  marginBottom?: number | string
}

/**
 * Tira de pestañas de nivel 2 (sub-menú de una sección).
 *
 * Es el patrón que ya usaba el módulo de Condominios, extraído para que TODAS
 * las secciones se vean igual. La diferencia importante está en móvil: una
 * sola fila con scroll horizontal en vez de `flex-wrap`. Con wrap, un módulo
 * como Contabilidad (9 pestañas) ocupaba cuatro líneas en un teléfono y
 * empujaba el contenido real fuera de la pantalla; con scroll ocupa siempre
 * una línea y el usuario desliza.
 *
 * `whiteSpace: nowrap` + `flexShrink: 0` evitan que las pestañas se compriman
 * hasta quedar ilegibles cuando no caben.
 *
 * A11y: patrón Tab de WAI-ARIA — roving tabindex (solo la pestaña activa es
 * tabulable) y flechas ←/→ para moverse entre pestañas. `aria-controls` se
 * omite a propósito: el panel se renderiza fuera de este componente y apuntar
 * a un id inexistente es una violación de axe.
 */
export function TabStrip<T extends string>({ items, value, onChange, ariaLabel, marginBottom = 0 }: Props<T>) {
  const stripRef = useRef<HTMLDivElement>(null)

  // Con scroll horizontal la pestaña activa puede quedar fuera de la vista
  // (p. ej. al entrar en una sección con la 7ª pestaña seleccionada, o al
  // volver de un deep-link). La traemos al viewport de la tira, no de la
  // página: `block: 'nearest'` evita que el scroll vertical salte.
  useEffect(() => {
    const active = stripRef.current?.querySelector('[aria-selected="true"]')
    // `?.()` a propósito: jsdom no implementa scrollIntoView y no queremos que
    // los tests de las secciones que usan la tira revienten por eso.
    active?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
  }, [value])

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const i = items.findIndex(t => t.id === value)
    if (i === -1) return
    const delta = e.key === 'ArrowRight' ? 1 : -1
    const next = items[(i + delta + items.length) % items.length]
    e.preventDefault()
    onChange(next.id)
  }

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className="tab-strip-scrollable"
      style={{
        display: 'flex',
        gap: 1,
        overflowX: 'auto',
        borderBottom: '2px solid var(--at-line)',
        marginBottom,
      }}
    >
      {items.map(tab => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-current={active ? 'page' : undefined}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
              padding: '7px 13px',
              border: 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              background: active ? 'var(--at-ink)' : 'var(--at-chip)',
              color: active ? 'white' : 'var(--at-ink-3)',
              borderRadius: '6px 6px 0 0',
              borderBottom: active ? '2px solid var(--at-ink)' : '2px solid transparent',
              marginBottom: -2,
            }}
          >
            {tab.icon && <span aria-hidden="true">{tab.icon}</span>}
            <span>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
