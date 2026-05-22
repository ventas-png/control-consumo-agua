import type { ReactNode } from 'react'
import type { UserRole } from '../../types'

export function AccessDenied() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '80px 24px',
      textAlign: 'center',
    }}>
      <div style={{
        width: '64px',
        height: '64px',
        borderRadius: '50%',
        background: 'var(--at-danger-tint)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '20px',
      }}>
        <svg width="32" height="32" fill="none" stroke="var(--at-danger)" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 15v.01M12 9v2m0 8a8 8 0 100-16 8 8 0 000 16z" />
        </svg>
      </div>
      <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--at-danger-strong)', marginBottom: '8px' }}>
        Acceso Denegado
      </h2>
      <p style={{ fontSize: '14px', color: 'var(--at-ink-3)', maxWidth: '400px' }}>
        No tienes permisos para acceder a esta seccion.
        Contacta a tu administrador si necesitas acceso.
      </p>
    </div>
  )
}

interface Props {
  userRole: UserRole
  allowedRoles: UserRole[]
  children: ReactNode
}

export function RoleGuard({ userRole, allowedRoles, children }: Props) {
  if (!allowedRoles.includes(userRole)) {
    return <AccessDenied />
  }
  return <>{children}</>
}
