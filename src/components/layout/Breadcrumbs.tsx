import { Fragment } from 'react'
import type { AppSection } from '../../types'
import { buildBreadcrumbs } from './navRegistry'

// agua:B11 — Breadcrumbs de navegación (T6 · UX, épica #306).
//
// Muestra la ruta jerárquica actual "Sección › Subsección/Tab" derivada del
// `navRegistry` (que espeja la estructura de grupos/tabs del Sidebar). Es
// reactivo: App.tsx pasa `activeSection` derivado de la URL, así que cambia sin
// recarga al navegar. Los niveles superiores son clickables para "subir" (vía
// `onNavigate`, el mismo navigateSection que usa el resto del layout).
//
// Complementa —no reemplaza— al CondominioContextBar (#392), que vive DENTRO de
// la sección Condominios e indica el CONDOMINIO ACTIVO (contexto de datos). El
// breadcrumb indica la POSICIÓN en el árbol de navegación. Son ejes distintos.
//
// A11y: <nav aria-label>, lista ordenada, aria-current="page" en el último
// nivel, navegable por teclado (los niveles enlazados son <button> nativos).

interface Props {
  activeSection: AppSection
  /** Navega a la sección indicada (sin recarga). Espeja navigateSection de App. */
  onNavigate: (section: AppSection) => void
}

function Separator() {
  // Decorativo: el separador no se anuncia a lectores de pantalla (la estructura
  // de lista ya comunica la jerarquía). chevron `›`.
  return (
    <li aria-hidden="true" style={{ display: 'flex', alignItems: 'center', color: 'var(--at-ink-3)', userSelect: 'none' }}>
      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ opacity: 0.6 }}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </li>
  )
}

export function Breadcrumbs({ activeSection, onNavigate }: Props) {
  const crumbs = buildBreadcrumbs(activeSection)

  return (
    <nav
      aria-label="Ruta de navegación"
      className="app-breadcrumbs"
      style={{
        padding: '8px 32px',
        background: 'var(--at-surface)',
        borderBottom: '1px solid var(--at-line)',
        flexShrink: 0,
      }}
    >
      <ol
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          flexWrap: 'wrap',
          fontSize: '12.5px',
        }}
      >
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1
          return (
            <Fragment key={`${crumb.label}-${i}`}>
              {i > 0 && <Separator />}
              <li style={{ display: 'flex', alignItems: 'center' }}>
                {crumb.target && !isLast ? (
                  <button
                    type="button"
                    onClick={() => onNavigate(crumb.target!)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      padding: '2px 4px',
                      margin: 0,
                      cursor: 'pointer',
                      color: 'var(--at-ink-3)',
                      fontSize: 'inherit',
                      fontWeight: 500,
                      borderRadius: '5px',
                      lineHeight: 1.4,
                      transition: 'color 0.13s, background 0.13s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.color = 'var(--at-primary)'
                      e.currentTarget.style.background = 'var(--at-surface-2)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.color = 'var(--at-ink-3)'
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span
                    aria-current={isLast ? 'page' : undefined}
                    style={{
                      padding: '2px 4px',
                      color: isLast ? 'var(--at-ink)' : 'var(--at-ink-3)',
                      fontWeight: isLast ? 650 : 500,
                      lineHeight: 1.4,
                    }}
                  >
                    {crumb.label}
                  </span>
                )}
              </li>
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}
