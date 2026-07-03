import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SessionProvider } from '../SessionContext'
import { PermissionsProvider, usePermissionsContext } from '../PermissionsContext'
import type { UserSession } from '../../../types'

const ownerUser: UserSession = {
  user_id: 'u1',
  email: 'o@e.com',
  name: 'Owner',
  role: 'company_owner',
  company_id: 'c1',
  login_time: '2026-01-01T00:00:00Z',
  expires_at: '2026-01-02T00:00:00Z',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PermissionsContext', () => {
  it('expone la API de permisos dentro de los providers (company_owner exento → todo true)', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider value={ownerUser}>
        <PermissionsProvider>{children}</PermissionsProvider>
      </SessionProvider>
    )
    const { result } = renderHook(() => usePermissionsContext(), { wrapper })
    expect(result.current.canViewModule('clientes')).toBe(true)
    expect(result.current.canCreate('clientes')).toBe(true)
    expect(result.current.canEdit('tarifas')).toBe(true)
    expect(result.current.canChangeStatus('cobros')).toBe(true)
    expect(result.current.canApprove('cobros')).toBe(true)
    expect(result.current.canDelete('clientes')).toBe(true)
  })

  it('lanza (fail loud) si se usa fuera de <PermissionsProvider>', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => usePermissionsContext())).toThrow(/PermissionsProvider/)
  })
})
