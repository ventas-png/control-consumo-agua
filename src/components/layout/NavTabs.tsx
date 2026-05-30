import type { AppSection, UserRole } from '../../types'

interface Tab {
  id: AppSection
  label: string
  roles: UserRole[]
}

const TABS: Tab[] = [
  { id: 'clientes', label: '👥 Clientes', roles: ['admin', 'super_admin', 'operator'] },
  { id: 'lecturas', label: '💧 Nueva Lectura', roles: ['admin', 'super_admin', 'operator'] },
  { id: 'tabla', label: '📋 Historial', roles: ['admin', 'super_admin', 'operator', 'viewer'] },
  { id: 'dashboard', label: '📊 Dashboard', roles: ['admin', 'super_admin', 'operator', 'viewer'] },
  { id: 'mapa', label: '🗺️ Mapa', roles: ['admin', 'super_admin', 'operator', 'viewer'] },
  { id: 'calidad', label: '🔬 Calidad Agua', roles: ['admin', 'super_admin', 'operator'] },
  { id: 'configuracion', label: '⚙️ Configuración', roles: ['admin', 'super_admin'] },
]

interface Props {
  activeSection: AppSection
  userRole: UserRole
  onSelect: (section: AppSection) => void
}

// F3.3: agrega semantica ARIA Tab Pattern (WAI-ARIA Authoring Practices) — antes
// era solo <button>s sin role; ahora screen readers anuncian "tab N of N, selected".
export function NavTabs({ activeSection, userRole, onSelect }: Props) {
  const visibleTabs = TABS.filter(t => t.roles.includes(userRole))

  return (
    <div
      role="tablist"
      aria-label="Secciones del módulo de agua"
      style={{ display: 'flex', gap: '8px', background: 'var(--at-surface)', padding: '8px', borderRadius: '12px', marginBottom: '20px', overflowX: 'auto' }}
    >
      {visibleTabs.map(tab => {
        const isActive = activeSection === tab.id
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            id={`tab-${tab.id}`}
            aria-selected={isActive}
            // aria-controls omitido a proposito: el panel se renderiza fuera de
            // este componente (en App.tsx via switch en activeSection). axe
            // marca aria-controls a un id inexistente como violacion. La spec
            // WAI-ARIA permite omitirlo cuando el panel no es co-located.
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            style={{
              padding: '10px 20px', border: 'none', borderRadius: '8px', cursor: 'pointer',
              fontWeight: 500, whiteSpace: 'nowrap', transition: 'all 0.2s',
              background: isActive
                ? 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)'
                : 'transparent',
              color: isActive ? 'white' : '#4a5568',
              boxShadow: isActive ? '0 4px 16px rgba(27, 59, 54,0.4)' : 'none',
            }}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
