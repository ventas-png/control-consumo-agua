interface Props {
  onNavigate: (section: 'mapa' | 'rutas' | 'contadores' | 'calidad') => void
}

export function AdminQuickActions({ onNavigate }: Props) {
  const actions = [
    {
      id: 'mapa',
      label: 'Ver Mapa',
      description: 'Ubicaciones de lecturas',
      icon: '🗺️',
      color: '#1B3B36',
    },
    {
      id: 'rutas',
      label: 'Armar Rutas',
      description: 'Crear/editar rutas',
      icon: '🚗',
      color: '#f59e0b',
    },
    {
      id: 'contadores',
      label: 'Contadores',
      description: 'Gestionar contadores',
      icon: '📊',
      color: '#10b981',
    },
    {
      id: 'calidad',
      label: 'Calidad de Agua',
      description: 'Parámetros de calidad',
      icon: '💧',
      color: '#B96A3F',
    },
  ]

  return (
    <div style={{ marginTop: '32px', marginBottom: '32px' }}>
      <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '16px', color: '#15291F' }}>
        Acceso Rápido
      </h3>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: '12px',
      }}>
        {actions.map(action => (
          <button
            key={action.id}
            onClick={() => onNavigate(action.id as 'mapa' | 'rutas' | 'contadores' | 'calidad')}
            style={{
              padding: '16px',
              background: 'white',
              border: `2px solid ${action.color}20`,
              borderRadius: '12px',
              cursor: 'pointer',
              textAlign: 'center',
              transition: 'all 0.2s',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget
              el.style.background = `${action.color}10`
              el.style.transform = 'translateY(-2px)'
              el.style.boxShadow = `0 8px 16px ${action.color}20`
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget
              el.style.background = 'white'
              el.style.transform = 'translateY(0)'
              el.style.boxShadow = 'none'
            }}
          >
            <div style={{ fontSize: '28px' }}>{action.icon}</div>
            <div style={{
              fontSize: '13px',
              fontWeight: '700',
              color: action.color,
            }}>
              {action.label}
            </div>
            <div style={{
              fontSize: '11px',
              color: '#7E9389',
              fontWeight: '500',
            }}>
              {action.description}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
