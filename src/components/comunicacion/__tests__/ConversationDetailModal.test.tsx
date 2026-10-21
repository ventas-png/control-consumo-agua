import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { Conversation, ConversationMessage } from '../../../types'

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) } }))

import { ConversationDetailModal } from '../ConversationDetailModal'

beforeEach(cleanup)

const conv: Conversation = {
  id: 'c1',
  company_id: 'co1',
  cliente_nombre: 'Carlos García',
  subject: 'Revisión de pago',
  category: 'pagos',
  priority: 'alta',
  status: 'en_progreso',
  assigned_to: 'u2',
  assigned_name: 'Santos',
  created_at: '2026-10-14T10:00:00Z',
  updated_at: '2026-10-14T10:00:00Z',
}

function msg(over: Partial<ConversationMessage>): ConversationMessage {
  return {
    id: Math.random().toString(36).slice(2),
    conversation_id: 'c1',
    sender_id: 'u2',
    sender_type: 'agent',
    sender_name: 'Santos',
    body: 'hola',
    is_internal_note: false,
    created_at: '2026-10-14T14:58:00',
    ...over,
  }
}

function renderModal(over: Partial<ComponentProps<typeof ConversationDetailModal>> = {}) {
  const props: ComponentProps<typeof ConversationDetailModal> = {
    conversation: conv,
    messages: [],
    canCreate: true,
    canEdit: true,
    currentUserId: 'u1',
    activeAssignments: [],
    onClose: vi.fn(),
    onChangeStatus: vi.fn(),
    onAssignToMe: vi.fn(),
    onUnassign: vi.fn(),
    onOpenAssignModal: vi.fn(),
    onRemoveAssignment: vi.fn(),
    messageText: '',
    onChangeMessage: vi.fn(),
    isInternalNote: false,
    onToggleInternalNote: vi.fn(),
    pendingFile: null,
    onPickFile: vi.fn(),
    sending: false,
    onSendMessage: vi.fn(),
    ...over,
  }
  return { props, ...render(<ConversationDetailModal {...props} />) }
}

describe('ConversationDetailModal', () => {
  it('se abre como ventana emergente con el asunto de título', () => {
    renderModal()
    const dialog = screen.getByRole('dialog', { name: 'Revisión de pago' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText(/Carlos García/)).toBeDefined()
  })

  it('solo pinta los mensajes de ESTA conversación', () => {
    renderModal({
      messages: [
        msg({ body: 'ya encontramos su pago' }),
        msg({ conversation_id: 'otra', body: 'mensaje de otra conversación' }),
      ],
    })
    expect(screen.getByText('ya encontramos su pago')).toBeDefined()
    expect(screen.queryByText('mensaje de otra conversación')).toBeNull()
  })

  it('separa los mensajes por día', () => {
    renderModal({
      messages: [
        msg({ body: 'primero', created_at: '2026-10-13T09:00:00' }),
        msg({ body: 'segundo', created_at: '2026-10-13T10:00:00' }),
        msg({ body: 'tercero', created_at: '2026-10-14T09:00:00' }),
      ],
    })
    expect(screen.getAllByRole('separator')).toHaveLength(2)
  })

  it('marca las notas internas', () => {
    renderModal({ messages: [msg({ body: 'pedro atender esto', is_internal_note: true })] })
    expect(screen.getByText(/Nota interna · Santos/)).toBeDefined()
  })

  it('cerrar la ventana llama a onClose', () => {
    const { props } = renderModal()
    fireEvent.click(screen.getByLabelText('Cerrar modal'))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('el selector de estado cambia el estado', () => {
    const { props } = renderModal()
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'resuelta' } })
    expect(props.onChangeStatus).toHaveBeenCalledWith('resuelta')
  })

  it('el tipo de mensaje se elige con un control segmentado', () => {
    const { props } = renderModal()
    fireEvent.click(screen.getByRole('radio', { name: /Nota interna/ }))
    expect(props.onToggleInternalNote).toHaveBeenCalledWith(true)
  })

  it('una discusión de equipo no ofrece "Responder al cliente"', () => {
    renderModal({ conversation: { ...conv, is_internal: true } })
    expect(screen.queryByRole('radio', { name: /Responder al cliente/ })).toBeNull()
  })

  it('cerrada: sin compositor y con botón para reabrir', () => {
    const { props } = renderModal({ conversation: { ...conv, status: 'cerrada' } })
    expect(screen.queryByLabelText('Mensaje')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reabrir conversación' }))
    expect(props.onChangeStatus).toHaveBeenCalledWith('abierta')
  })

  it('sin permiso de edición no muestra la barra de gestión', () => {
    renderModal({ canEdit: false })
    expect(screen.queryByLabelText('Estado')).toBeNull()
  })

  it('quitar a un miembro del equipo llama a onRemoveAssignment', () => {
    const { props } = renderModal({ activeAssignments: [{ id: 'a1', user_name: 'Pedro Ramírez' }] })
    fireEvent.click(screen.getByLabelText('Quitar a Pedro Ramírez'))
    expect(props.onRemoveAssignment).toHaveBeenCalledWith('a1')
  })
})
