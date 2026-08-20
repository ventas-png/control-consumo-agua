// Regresión react-hooks/exhaustive-deps: los tres useCallback de useConversations
// leían `serviceType` sin declararlo. La consecuencia era una closure obsoleta —
// al pasar del área de agua a la de condominios (mismo componente, distinta
// prop) el hook seguía consultando y CREANDO conversaciones con el service_type
// anterior, mezclando bandejas de dos áreas.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ConversationServiceType } from '../../types'

const h = vi.hoisted(() => ({
  fetchConversations: vi.fn(async () => []),
  createConversationWithFirstMessage: vi.fn(async () => ({ id: 'c1' })),
  createInternalConversation: vi.fn(async () => ({ id: 'c2' })),
  channel: vi.fn(),
  removeChannel: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: h.removeChannel,
  },
}))

vi.mock('../../domain/comunicacion/conversations', () => ({
  fetchConversations: h.fetchConversations,
  fetchConversationMessages: vi.fn(async () => []),
  fetchAccessRules: vi.fn(async () => []),
  createConversationWithFirstMessage: h.createConversationWithFirstMessage,
  createInternalConversation: h.createInternalConversation,
  sendConversationMessage: vi.fn(async () => undefined),
  updateConversation: vi.fn(async () => undefined),
  fetchAssignments: vi.fn(async () => []),
  assignConversationToUsers: vi.fn(async () => undefined),
  deleteAssignment: vi.fn(async () => undefined),
  markAssignmentSeen: vi.fn(async () => true),
  saveAccessRule: vi.fn(async () => undefined),
}))

import { useConversations } from '../useConversations'

beforeEach(() => {
  h.fetchConversations.mockClear()
  h.createConversationWithFirstMessage.mockClear()
  h.createInternalConversation.mockClear()
})

const base = { companyId: 'emp-1', userId: 'u-1' }

describe('useConversations reacciona a serviceType', () => {
  it('loadConversations consulta con el serviceType ACTUAL tras un rerender', async () => {
    const { result, rerender } = renderHook(
      ({ serviceType }) => useConversations({ ...base, serviceType }),
      { initialProps: { serviceType: 'agua' as ConversationServiceType } },
    )

    await act(async () => { await result.current.loadConversations() })
    expect(h.fetchConversations).toHaveBeenLastCalledWith(
      expect.objectContaining({ serviceType: 'agua' }),
    )

    rerender({ serviceType: 'condominios' })
    await act(async () => { await result.current.loadConversations() })

    expect(h.fetchConversations).toHaveBeenLastCalledWith(
      expect.objectContaining({ serviceType: 'condominios' }),
    )
  })

  it('loadConversations cambia de identidad al cambiar serviceType', () => {
    const { result, rerender } = renderHook(
      ({ serviceType }) => useConversations({ ...base, serviceType }),
      { initialProps: { serviceType: 'agua' as ConversationServiceType } },
    )
    const primero = result.current.loadConversations

    rerender({ serviceType: 'agua' })
    expect(result.current.loadConversations).toBe(primero)   // sin cambio real → estable

    rerender({ serviceType: 'condominios' })
    expect(result.current.loadConversations).not.toBe(primero)
  })

  it('createConversation crea con el serviceType ACTUAL', async () => {
    const { result, rerender } = renderHook(
      ({ serviceType }) => useConversations({ ...base, serviceType }),
      { initialProps: { serviceType: 'agua' as ConversationServiceType } },
    )

    rerender({ serviceType: 'condominios' })
    await act(async () => {
      await result.current.createConversation({
        subject: 'Fuga en el pasillo', category: 'general', priority: 'media',
        clienteId: 'cli-1', clienteNombre: 'Ana', companyId: 'emp-1',
        firstMessage: 'Hola', senderName: 'Ana',
      })
    })

    expect(h.createConversationWithFirstMessage).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ serviceType: 'condominios' }),
    )
  })

  it('createInternalConversation crea con el serviceType ACTUAL', async () => {
    const { result, rerender } = renderHook(
      ({ serviceType }) => useConversations({ ...base, serviceType }),
      { initialProps: { serviceType: 'agua' as ConversationServiceType } },
    )

    rerender({ serviceType: 'condominios' })
    await act(async () => {
      await result.current.createInternalConversation({
        subject: 'Turno de noche', category: 'general',
        firstMessage: 'Nota interna', senderName: 'Admin', companyId: 'emp-1',
      })
    })

    expect(h.createInternalConversation).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ serviceType: 'condominios' }),
    )
  })

  it('el efecto de realtime de la lista se resuscribe (cleanup) al cambiar serviceType', async () => {
    const { rerender } = renderHook(
      ({ serviceType }) => useConversations({ ...base, serviceType }),
      { initialProps: { serviceType: 'agua' as ConversationServiceType } },
    )
    h.removeChannel.mockClear()

    rerender({ serviceType: 'condominios' })

    await waitFor(() => expect(h.removeChannel).toHaveBeenCalled())
  })
})
