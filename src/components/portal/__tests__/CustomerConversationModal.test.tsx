import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { Conversation, ConversationMessage } from '../../../types'

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) } }))

import { CustomerConversationModal } from '../CustomerConversationModal'
import { NuevaConsultaModal } from '../NuevaConsultaModal'

beforeEach(cleanup)

const conv: Conversation = {
  id: 'c1',
  company_id: 'co1',
  cliente_nombre: 'Carlos García',
  subject: 'Mi factura de marzo',
  category: 'pagos',
  priority: 'media',
  status: 'esperando_cliente',
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

function renderModal(over: Partial<ComponentProps<typeof CustomerConversationModal>> = {}) {
  const props: ComponentProps<typeof CustomerConversationModal> = {
    conversation: conv,
    messages: [],
    messageText: '',
    onChangeMessage: vi.fn(),
    pendingFile: null,
    onPickFile: vi.fn(),
    sending: false,
    onSend: vi.fn(),
    onClose: vi.fn(),
    onNewConsulta: vi.fn(),
    ...over,
  }
  return { props, ...render(<CustomerConversationModal {...props} />) }
}

describe('CustomerConversationModal', () => {
  it('se abre como ventana a pantalla completa en el teléfono', () => {
    renderModal()
    const dialog = screen.getByRole('dialog', { name: 'Mi factura de marzo' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(screen.getByText('Esperando tu respuesta')).toBeDefined()
    expect(screen.getByText(/Te atiende Santos/)).toBeDefined()
  })

  it('nunca muestra las notas internas del equipo', () => {
    renderModal({
      messages: [
        msg({ body: 'ya encontramos su pago' }),
        msg({ body: 'pedro atender esto', is_internal_note: true }),
      ],
    })
    expect(screen.getByText('ya encontramos su pago')).toBeDefined()
    expect(screen.queryByText('pedro atender esto')).toBeNull()
  })

  it('sus propios mensajes van sin nombre; los de la empresa, con nombre', () => {
    renderModal({
      messages: [
        msg({ body: 'respuesta de la empresa' }),
        msg({ body: 'mensaje mío', sender_type: 'cliente', sender_name: 'Carlos García' }),
      ],
    })
    expect(screen.getByText('Santos')).toBeDefined()
    expect(screen.queryByText('Carlos García', { selector: 'div' })).toBeNull()
  })

  it('el compositor no ofrece nota interna', () => {
    renderModal()
    expect(screen.getByLabelText('Mensaje')).toBeDefined()
    expect(screen.queryByRole('radio', { name: /Nota interna/ })).toBeNull()
  })

  it('resuelta: sin compositor y con atajo a una nueva consulta', () => {
    const { props } = renderModal({ conversation: { ...conv, status: 'resuelta' } })
    expect(screen.queryByLabelText('Mensaje')).toBeNull()
    expect(screen.getByText(/marcada como resuelta/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /Nueva consulta/ }))
    expect(props.onNewConsulta).toHaveBeenCalledTimes(1)
  })
})

describe('NuevaConsultaModal', () => {
  it('valida asunto y mensaje antes de enviar', async () => {
    const onSubmit = vi.fn(async () => null)
    render(<NuevaConsultaModal onClose={() => {}} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Enviar consulta' }))
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('envía tipo, urgencia, asunto y mensaje', async () => {
    const onSubmit = vi.fn(async () => null)
    render(<NuevaConsultaModal onClose={() => {}} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('radio', { name: /Pagos/ }))
    fireEvent.click(screen.getByRole('radio', { name: 'Alta' }))
    fireEvent.change(screen.getByLabelText('Asunto *'), { target: { value: 'Cobro duplicado' } })
    fireEvent.change(screen.getByLabelText('Describe tu consulta *'), { target: { value: 'Me cobraron dos veces' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar consulta' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      subject: 'Cobro duplicado', category: 'pagos', priority: 'alta', message: 'Me cobraron dos veces',
    }))
  })

  it('muestra el error que devuelve el alta', async () => {
    render(<NuevaConsultaModal onClose={() => {}} onSubmit={async () => 'No se encontró tu perfil de cliente.'} />)
    fireEvent.change(screen.getByLabelText('Asunto *'), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText('Describe tu consulta *'), { target: { value: 'y' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar consulta' }))
    expect((await screen.findByRole('alert')).textContent).toContain('No se encontró tu perfil')
  })
})
