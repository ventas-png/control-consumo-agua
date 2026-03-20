import type { AppSection, UserSession } from '../../types'
import { useOffline } from '../../hooks/useOffline'

const PAGE_TITLES: Record<AppSection, string> = {
  clientes: 'Clientes',
  lecturas: 'Nueva Lectura',
  tabla: 'Historial de Lecturas',
  dashboard: 'Dashboard',
  mapa: 'Mapa de Clientes',
  calidad: 'Calidad del Agua',
  configuracion: 'Configuración',
  perfil: 'Mi Cuenta',
  empresa_proyectos: 'Mis Proyectos',
  superadmin_empresas: 'Gestión de Empresas',
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase()
}

interface Props {
  activeSection: AppSection
  currentUser: UserSession
}

export function Topbar({ activeSection, currentUser }: Props) {
  const { isOnline } = useOffline()

  return (
    <header
      style={{
        background: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        padding: '0 28px',
        height: '64px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}
    >
      {/* Page title */}
      <div>
        <h1
          style={{
            fontSize: '18px',
            fontWeight: 700,
            color: '#0f172a',
            margin: 0,
          }}
        >
          {PAGE_TITLES[activeSection]}
        </h1>
      </div>

      {/* Right side */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Online / offline badge */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 12px',
            background: isOnline ? '#f0fdf4' : '#fffbeb',
            color: isOnline ? '#166534' : '#92400e',
            borderRadius: '20px',
            fontSize: '12px',
            fontWeight: 500,
            border: `1px solid ${isOnline ? '#bbf7d0' : '#fde68a'}`,
          }}
        >
          <span
            style={{
              width: '7px',
              height: '7px',
              background: isOnline ? '#22c55e' : '#f59e0b',
              borderRadius: '50%',
              display: 'inline-block',
              boxShadow: isOnline ? '0 0 0 2px rgba(34,197,94,0.2)' : '0 0 0 2px rgba(245,158,11,0.2)',
            }}
          />
          {isOnline ? 'Conectado' : 'Offline'}
        </span>

        {/* User avatar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '6px 12px 6px 6px',
            borderRadius: '24px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #0ea5e9, #0d9488)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontWeight: 700,
              fontSize: '12px',
              flexShrink: 0,
            }}
          >
            {getInitials(currentUser.name)}
          </div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', lineHeight: '1.2' }}>
              {currentUser.name.split(' ')[0]}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>
              {currentUser.role}
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
