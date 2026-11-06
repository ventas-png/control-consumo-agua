import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
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
vi.mock('../../../../lib/storageUrls', () => ({
  // SecureFileLink/SecureImage no renderizan hasta tener la URL firmada, y el
  // cliente de storage está mockeado; se devuelve una firma fija.
  useSignedUrl: (src: string | null) => (src ? `https://firmado.test/${src}` : null),
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
    prioridad: 'media', estado: 'abierto', foto_urls: [], archivo_urls: [],
    created_at: '2026-07-20T10:00:00.000Z', updated_at: '2026-07-20T10:00:00.000Z',
    ...over,
  }
}

function comentario(over: Partial<ComentarioTicket> = {}): ComentarioTicket {
  return {
    id: 'm1', company_id: 'c1', ticket_id: 't1',
    autor_nombre: 'Administración', contenido: 'Vamos hoy en la tarde',
    foto_urls: [], archivo_urls: [], es_interno: false, created_at: '2026-07-21T09:00:00.000Z',
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

/** La tarjeta abre la ficha en ventana; la conversación vive en su pie. */
const abrirFicha = (titulo = 'Fuga en el baño') => fireEvent.click(screen.getByRole('button', { name: titulo }))
const ficha = (titulo = 'Fuga en el baño') => screen.getByRole('dialog', { name: titulo })
const pie = (titulo?: string) => ficha(titulo).querySelector('.at-modal-footer') as HTMLElement

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
    expect(payload.archivo_urls).toEqual([])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('ofrece adjuntar documentos además de fotos', () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Nueva solicitud'))
    expect(screen.getByText(/Documentos \(cotización, garantía…\)/)).toBeTruthy()
    expect(screen.getByText(/PDF, Word o Excel/)).toBeTruthy()
  })

  it('la tarjeta cuenta los documentos adjuntos y la ficha los lista con enlace para abrirlos', async () => {
    renderTab({ tickets: [ticket({ archivo_urls: ['p1/tickets/1785540000000-a3f9x2-cotizacion.pdf'] })] })
    expect(screen.getByText('📎 1 archivo')).toBeTruthy()
    expect(screen.queryByText('cotizacion.pdf')).toBeNull()
    abrirFicha()
    expect(await screen.findByText('cotizacion.pdf')).toBeTruthy()
  })
})

describe('PortalMisTicketsTab — conversación del ticket', () => {
  it('muestra el conteo de mensajes en la tarjeta y en el botón del pie de la ficha', async () => {
    mocks.fetchConteoComentariosTickets.mockResolvedValue({ t1: 3 })
    renderTab()
    expect(await screen.findByText('💬 3')).toBeTruthy()
    abrirFicha()
    expect(within(pie()).getByRole('button', { name: '💬 Conversación (3)' })).toBeTruthy()
  })

  it('abre el hilo del ticket y pinta los mensajes existentes', async () => {
    mocks.fetchComentariosTicket.mockResolvedValue([comentario()])
    renderTab()
    abrirFicha()
    fireEvent.click(within(pie()).getByRole('button', { name: '💬 Escribir al equipo' }))

    expect(await screen.findByText('Vamos hoy en la tarde')).toBeTruthy()
    expect(mocks.fetchComentariosTicket).toHaveBeenCalledWith('t1')
    // El reporte original encabeza el hilo (además de la tarjeta de la lista y la ficha).
    expect(screen.getByText('Reporte original')).toBeTruthy()
    expect(screen.getAllByText('Gotea la regadera')).toHaveLength(3)
  })

  it('el residente envía un mensaje sin estado_nuevo ni nota interna', async () => {
    renderTab()
    abrirFicha()
    fireEvent.click(within(pie()).getByRole('button', { name: '💬 Escribir al equipo' }))
    await screen.findByLabelText('Mensaje')

    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: 'Sigue goteando' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('comentarios_ticket')
    expect(payload).toMatchObject({
      ticket_id: 't1', company_id: 'c1',
      autor_nombre: 'Marco Santos', contenido: 'Sigue goteando',
      estado_nuevo: null, es_interno: false,
    })
    expect(payload.archivo_urls).toEqual([])
    // Sin permiso para mover el ticket: el residente no ve el selector de estado.
    expect(screen.queryByLabelText('Cambiar estado del ticket')).toBeNull()
  })

  it('la vista previa del panel sin canEdit(portal) muestra el hilo pero no deja escribir', async () => {
    // La base exige condominios.tab.portal.edit al mensaje del staff (supabase/rls-acciones/operaciones.json).
    mocks.fetchComentariosTicket.mockResolvedValue([comentario()])
    renderTab({ canWrite: false })
    abrirFicha()
    fireEvent.click(within(pie()).getByRole('button', { name: '💬 Escribir al equipo' }))

    expect(await screen.findByText('Vamos hoy en la tarde')).toBeTruthy()
    expect(screen.queryByLabelText('Mensaje')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enviar mensaje' })).toBeNull()
  })

  it('el hilo acepta documentos, no solo fotos', async () => {
    renderTab()
    abrirFicha()
    fireEvent.click(within(pie()).getByRole('button', { name: '💬 Escribir al equipo' }))
    await screen.findByLabelText('Mensaje')
    // Los adjuntos van en una bandeja plegable bajo el botón del clip.
    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar fotos o documentos' }))
    expect(screen.getByText(/Adjuntar documentos/)).toBeTruthy()
  })

  it('no envía un mensaje vacío sin fotos ni documentos', async () => {
    renderTab()
    abrirFicha()
    fireEvent.click(within(pie()).getByRole('button', { name: '💬 Escribir al equipo' }))
    await screen.findByLabelText('Mensaje')

    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }))
    await waitFor(() => expect(mocks.createCondominioRow).not.toHaveBeenCalled())
  })
})

describe('PortalMisTicketsTab — la ficha abre en ventana', () => {
  it('sin pulsar nada sólo hay tarjetas compactas; la tarjeta abre la ficha a pantalla completa en el teléfono', async () => {
    mocks.fetchConteoComentariosTickets.mockResolvedValue({ t1: 2 })
    renderTab({ tickets: [ticket({ asignado_a: 'Carlos Pérez', fecha_limite: '2026-07-25', foto_urls: ['p1/tickets/a.jpg', 'p1/tickets/b.jpg'] })] })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByText('💬 2')).toBeTruthy()
    expect(screen.getByText('📷 2 fotos')).toBeTruthy()
    // Lo que sólo va en la ficha.
    expect(screen.queryByText('Lo atiende')).toBeNull()
    expect(screen.queryByText('Carlos Pérez')).toBeNull()

    abrirFicha()
    const v = ficha()
    expect(v.classList.contains('at-modal--fs-mobile')).toBe(true)
    // Estado: chip del subtítulo, tarjeta de datos y línea del flujo. Urgencia: chip y tarjeta.
    expect(within(v).getAllByText(/Abierto$/)).toHaveLength(3)
    expect(within(v).getAllByText('Media')).toHaveLength(2)
    expect(within(v).getByText(/20 de julio de 2026/)).toBeTruthy()
    expect(within(v).getByText('Carlos Pérez')).toBeTruthy()
    expect(within(v).getByText(/25 de julio/)).toBeTruthy()
    expect(within(v).getByText('Gotea la regadera')).toBeTruthy()
    expect(within(v).getByText('Fotos')).toBeTruthy()
    expect(within(pie()).getAllByRole('button').map(b => b.textContent)).toEqual(['Cerrar', '💬 Conversación (2)'])
  })

  it('Cerrar, Escape y Enter; un ticket resuelto muestra su resolución; la conversación abre encima de la ficha y Escape cierra sólo la conversación', async () => {
    mocks.fetchComentariosTicket.mockResolvedValue([comentario()])
    renderTab({ tickets: [ticket({ estado: 'resuelto', fecha_cierre: '2026-07-22T15:00:00.000Z', notas_cierre: 'Se cambió el empaque.' })] })
    expect(screen.getByText(/^✅ Resuelto el /)).toBeTruthy()
    abrirFicha()
    const v = ficha()
    expect(within(v).getByText('Resolución')).toBeTruthy()
    expect(within(v).getByText('Se cambió el empaque.')).toBeTruthy()
    expect(within(v).getByText('Resuelto el')).toBeTruthy()
    fireEvent.click(within(pie()).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.keyDown(screen.getByRole('button', { name: 'Fuga en el baño' }), { key: 'Enter' })
    expect(ficha()).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    abrirFicha()
    fireEvent.click(within(pie()).getByRole('button', { name: '💬 Escribir al equipo' }))
    expect(await screen.findByText('Vamos hoy en la tarde')).toBeTruthy()
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    mocks.fetchConteoComentariosTickets.mockClear()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(ficha()).toBeTruthy()
    // Al cerrar la conversación se recarga el conteo de mensajes.
    await waitFor(() => expect(mocks.fetchConteoComentariosTickets).toHaveBeenCalledTimes(1))
  })
})
