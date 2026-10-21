import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import type { UserSession } from '../../../types'

const h = vi.hoisted(() => ({ markAsRead: vi.fn() }))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../hooks/useConversations', () => ({
  useConversations: () => ({
    conversations: [], messages: [], activeConversationId: null, loading: false, sending: false,
    loadConversations: async () => {}, loadMessages: async () => {}, createConversation: async () => null, sendMessage: async () => {},
  }),
}))
vi.mock('../../../hooks/useBroadcasts', () => ({
  useBroadcasts: () => ({
    clienteBroadcasts: [{
      id: 'r1', read_at: null,
      broadcast: { title: 'Corte programado', body: 'Mañana no habrá servicio de 8 a 12.\nAlmacene agua.', sent_by_name: 'Administración', created_at: '2026-10-20T10:00:00Z' },
    }],
    loadClienteBroadcasts: async () => {},
    markAsRead: h.markAsRead,
  }),
}))
vi.mock('../../comunicacion/NotificationPreferencesPanel', () => ({ NotificationPreferencesPanel: () => null }))

const { CustomerComunicacion } = await import('../CustomerComunicacion')

afterEach(cleanup)

describe('CustomerComunicacion — comunicados', () => {
  it('cada comunicado se abre completo en ventana y se marca como leído', () => {
    const user = { user_id: 'u1', cliente_id: 'cl1', name: 'Ana' } as unknown as UserSession
    render(<CustomerComunicacion currentUser={user} companyId="co1" />)
    fireEvent.click(screen.getByRole('tab', { name: /Comunicados/ }))
    fireEvent.click(screen.getByRole('button', { name: /Corte programado/ }))

    const dialog = screen.getByRole('dialog', { name: 'Corte programado' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText(/Almacene agua/)).toBeDefined()
    expect(h.markAsRead).toHaveBeenCalledWith('r1')
  })
})
