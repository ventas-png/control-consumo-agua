import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { ComentarioTicket, TicketMantenimiento } from '../../../../types'

// El tab entra a Supabase solo a través de la capa domain; se mockea ahí (y el
// cliente, que los uploaders importan de forma transitiva) para que el test
// ejercite la UI sin red ni env vars.
const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  fetchComentariosTicket: vi.fn(async () => [] as ComentarioTicket[]),
  fetchConteoComentariosTickets: vi.fn(async () => ({} as Record<string, number>)),
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: () => ({}) },
  db: { from: () => ({}) },
}))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({
  fetchComentariosTicket: mocks.fetchComentariosTicket,
  fetchConteoComentariosTickets: mocks.fetchConteoComentariosTickets,
}))

const { PortalMisTicketsTab } = await import('../PortalMisTicketsTab')

function ticket(over: Partial<TicketMantenimiento> = {}): TicketMantenimiento {
  return {
    id: 't1', company_id: 'c1', project_id: 'p1', unidad_id: 'u1',
    tipo: 'correctivo', titulo: 'Fuga en el baño', descripcion: 'Gotea la regadera',
    prioridad: 'media', estado: 'abierto', foto_urls: [],
    created_at: '2026-07-20T10:00:00.000Z', updated_at: '2026-07-20T10:00:00.000Z',
    ...over,
  }
}

function comentario(over: Partial<ComentarioTicket> = {}): ComentarioTicket {
  return {
    id: 'm1', company_id: 'c1', ticket_id: 't1',
    autor_nombre: 'Administración', contenido: 'Vamos hoy en la tarde',
    foto_urls: [], es_interno: false, created_at: '2026-07-21T09:00:00.000Z',
    ...over,
  }
}

function renderTab(props: Partial<Parameters<typeof PortalMisTicketsTab>[0]> = {}) {
  return render(
    <PortalMisTicketsTab
      tickets={[ticket()]}
      unidadId="u1"
      proyectoId="p1"
      companyId="c1"
      autorNombre="Marco Santos"
      autorUserId="user-1"
      onRefresh={() => {}}
      {...props}
    />,
  )
}

beforeEach(() => {
  mocks.createCondominioRow.mockClear()
  mocks.updateCondominioRow.mockClear()
  mocks.fetchComentariosTicket.mockClear()
  mocks.fetchComentariosTicket.mockResolvedValue([])
  mocks.fetchConteoComentariosTickets.mockClear()
  mocks.fetchConteoComentariosTickets.mockResolvedValue({})
})

afterEach(() => {
  cleanup()
})

describe('PortalMisTicketsTab — reporte en ventana emergente', () => {
  it('no muestra el formulario hasta pedir una nueva solicitud', () => {
    renderTab()
    expect(screen.queryByText('Reportar problema')).toBeNull()
  })

  it('abre el formulario como diálogo modal', () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Nueva solicitud'))
    const dialogo = screen.getByRole('dialog')
    expect(dialogo.getAttribute('aria-modal')).toBe('true')
    expect(dialogo.getAttribute('aria-label')).toBe('Reportar problema')
  })

  it('exige el título antes de enviar', async () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Nueva solicitud'))
    fireEvent.click(screen.getByText('📤 Enviar solicitud'))
    await waitFor(() => expect(mocks.createCondominioRow).not.toHaveBeenCalled())
  })

  it('envía la solicitud con las fotos adjuntas y cierra el diálogo', async () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Nueva solicitud'))
    fireEvent.change(screen.getByLabelText('¿Qué necesita atención? *'), { target: { value: 'Luz quemada' } })
    fireEvent.click(screen.getByText('Alta'))
    fireEvent.click(screen.getByText('📤 Enviar solicitud'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('tickets_mantenimiento')
    expect(payload).toMatchObject({
      unidad_id: 'u1', project_id: 'p1', company_id: 'c1',
      titulo: 'Luz quemada', prioridad: 'alta', estado: 'abierto',
    })
    expect(payload.foto_urls).toEqual([])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('PortalMisTicketsTab — conversación del ticket', () => {
  it('muestra el conteo de mensajes en la tarjeta', async () => {
    mocks.fetchConteoComentariosTickets.mockResolvedValue({ t1: 3 })
    renderTab()
    expect(await screen.findByText('💬 Conversación (3)')).toBeTruthy()
  })

  it('abre el hilo del ticket y pinta los mensajes existentes', async () => {
    mocks.fetchComentariosTicket.mockResolvedValue([comentario()])
    renderTab()
    fireEvent.click(screen.getByText('💬 Escribir al equipo'))

    expect(await screen.findByText('Vamos hoy en la tarde')).toBeTruthy()
    expect(mocks.fetchComentariosTicket).toHaveBeenCalledWith('t1')
    // El reporte original encabeza el hilo (además de la tarjeta de la lista).
    expect(screen.getByText('Reporte original')).toBeTruthy()
    expect(screen.getAllByText('Gotea la regadera')).toHaveLength(2)
  })

  it('el residente envía un mensaje sin estado_nuevo ni nota interna', async () => {
    renderTab()
    fireEvent.click(screen.getByText('💬 Escribir al equipo'))
    await screen.findByLabelText('Mensaje')

    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: 'Sigue goteando' } })
    fireEvent.click(screen.getByText('➤ Enviar mensaje'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('comentarios_ticket')
    expect(payload).toMatchObject({
      ticket_id: 't1', company_id: 'c1',
      autor_nombre: 'Marco Santos', contenido: 'Sigue goteando',
      estado_nuevo: null, es_interno: false,
    })
    // Sin permiso para mover el ticket: el residente no ve el selector de estado.
    expect(screen.queryByLabelText('Cambiar estado del ticket')).toBeNull()
  })

  it('no envía un mensaje vacío sin adjuntos', async () => {
    renderTab()
    fireEvent.click(screen.getByText('💬 Escribir al equipo'))
    await screen.findByLabelText('Mensaje')

    fireEvent.click(screen.getByText('➤ Enviar mensaje'))
    await waitFor(() => expect(mocks.createCondominioRow).not.toHaveBeenCalled())
  })
})
