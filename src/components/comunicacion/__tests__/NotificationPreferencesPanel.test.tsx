import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) } }))

const prefs = { in_app: true, email: true, whatsapp: false }
vi.mock('../../../domain/comunicacion/queries', () => ({
  useNotificationPreferencesQuery: () => ({ data: prefs, isLoading: false }),
}))
const mutateAsync = vi.fn()
vi.mock('../../../domain/comunicacion/mutations', () => ({
  useSaveNotificationPreferencesMutation: () => ({ mutateAsync, isPending: false }),
}))

import { NotificationPreferencesPanel } from '../NotificationPreferencesPanel'

beforeEach(() => {
  cleanup()
  mutateAsync.mockReset()
})

describe('NotificationPreferencesPanel', () => {
  it('cada interruptor se guarda al tocarlo, sin botón de guardar', async () => {
    mutateAsync.mockResolvedValue(undefined)
    render(<NotificationPreferencesPanel userId="u1" companyId="co1" lockInApp />)
    expect(screen.queryByRole('button', { name: /Guardar/ })).toBeNull()

    fireEvent.click(screen.getByRole('switch', { name: /WhatsApp/ }))
    expect(mutateAsync).toHaveBeenCalledWith({
      userId: 'u1', companyId: 'co1', preferences: { in_app: true, email: true, whatsapp: true },
    })
    expect(await screen.findByText('✓ Cambios guardados')).toBeDefined()
    expect(screen.getByRole('switch', { name: /WhatsApp/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('"En la app" bloqueado no se puede apagar', () => {
    render(<NotificationPreferencesPanel userId="u1" lockInApp />)
    const sw = screen.getByRole('switch', { name: /En la app/ })
    expect((sw as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('🔒 Siempre activo')).toBeDefined()
    fireEvent.click(sw)
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('si el guardado falla, el canal vuelve a como estaba', async () => {
    mutateAsync.mockRejectedValue(new Error('rls'))
    render(<NotificationPreferencesPanel userId="u1" lockInApp />)
    const sw = screen.getByRole('switch', { name: /Correo/ })
    fireEvent.click(sw)
    await waitFor(() => expect(screen.getByText('No se guardó')).toBeDefined())
    expect(screen.getByRole('switch', { name: /Correo/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('resume en una frase por dónde llegan los avisos', () => {
    render(<NotificationPreferencesPanel userId="u1" lockInApp />)
    expect(screen.getByText('Recibirás avisos en la app y por correo.')).toBeDefined()
  })
})
