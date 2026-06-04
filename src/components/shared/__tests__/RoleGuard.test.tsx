import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import { RoleGuard } from '../AccessDenied'
import { SessionProvider } from '../SessionContext'
import type { UserSession, UserRole } from '../../../types'

beforeEach(cleanup)

function renderWithRole(role: UserRole, children: ReactNode) {
  const user: UserSession = {
    user_id: 'u',
    email: 'e@e.com',
    name: 'N',
    role,
    login_time: '2026-01-01T00:00:00Z',
    expires_at: '2026-01-02T00:00:00Z',
  }
  return render(<SessionProvider value={user}>{children}</SessionProvider>)
}

describe('RoleGuard', () => {
  it('renderiza children cuando el rol (de la sesión) está permitido', () => {
    renderWithRole('company_owner', (
      <RoleGuard allowedRoles={['company_owner']}><div>contenido</div></RoleGuard>
    ))
    expect(screen.getByText('contenido')).toBeDefined()
  })

  it('renderiza AccessDenied (no children) cuando el rol no está permitido', () => {
    renderWithRole('viewer', (
      <RoleGuard allowedRoles={['company_owner']}><div>contenido</div></RoleGuard>
    ))
    expect(screen.queryByText('contenido')).toBeNull()
    expect(screen.getByText('Acceso Denegado')).toBeDefined()
  })
})
