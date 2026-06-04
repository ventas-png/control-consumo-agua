import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SessionProvider, useSession } from '../SessionContext'
import type { UserSession } from '../../../types'

const fakeUser: UserSession = {
  user_id: 'u1',
  email: 'u1@example.com',
  name: 'User One',
  role: 'company_owner',
  company_id: 'c1',
  login_time: '2026-01-01T00:00:00Z',
  expires_at: '2026-01-02T00:00:00Z',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SessionContext', () => {
  it('useSession devuelve el usuario provisto dentro del provider', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider value={fakeUser}>{children}</SessionProvider>
    )
    const { result } = renderHook(() => useSession(), { wrapper })
    expect(result.current).toBe(fakeUser)
    expect(result.current.user_id).toBe('u1')
  })

  it('useSession lanza (fail loud) si se usa fuera de un SessionProvider', () => {
    // React loguea el error de render en consola; lo silenciamos para no ensuciar
    // la salida del test (la aserción sigue verificando que efectivamente lanza).
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useSession())).toThrow(/SessionProvider/)
  })
})
