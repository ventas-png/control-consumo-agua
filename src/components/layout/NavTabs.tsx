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

export function NavTabs({ activeSection, userRole, onSelect }: Props) {
  const visibleTabs = TABS.filter(t => t.roles.includes(userRole))

  return (
    <div style={{ display: 'flex', gap: '8px', background: 'var(--at-surface)', padding: '8px', borderRadius: '12px', marginBottom: '20px', overflowX: 'auto' }}>
      {visibleTabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          style={{
            padding: '10px 20px', border: 'none', borderRadius: '8px', cursor: 'pointer',
            fontWeight: 500, whiteSpace: 'nowrap', transition: 'all 0.2s',
            background: activeSection === tab.id
              ? 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)'
              : 'transparent',
            color: activeSection === tab.id ? 'white' : '#4a5568',
            boxShadow: activeSection === tab.id ? '0 4px 16px rgba(27, 59, 54,0.4)' : 'none',
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
