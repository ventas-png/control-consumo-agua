import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { ComentarioMensajePortal, MensajePortal, Unidad } from '../../../../types'

// Igual que PortalMisTicketsTab.test: el tab entra a Supabase solo por la capa
// domain, así que se mockea ahí (y el cliente, que los uploaders importan de
// forma transitiva) para ejercitar la UI sin red ni env vars.
const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  fetchComentariosMensajePortal: vi.fn(async () => [] as ComentarioMensajePortal[]),
  fetchConteoComentariosMensajePortal: vi.fn(async () => ({} as Record<string, number>)),
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
  fetchComentariosMensajePortal: mocks.fetchComentariosMensajePortal,
  fetchConteoComentariosMensajePortal: mocks.fetchConteoComentariosMensajePortal,
}))

const { PortalMiUnidadTab } = await import('../PortalMiUnidadTab')

const unidad = { id: 'u1', nombre: 'Apto. 2A', activo: true } as unknown as Unidad

function mensaje(over: Partial<MensajePortal> = {}): MensajePortal {
  return {
    id: 'm1', company_id: 'c1', project_id: 'p1', unidad_id: 'u1',
    asunto: 'Ruido en el pasillo', cuerpo: 'Todas las noches después de las 11',
    tipo: 'queja', estado: 'nuevo', foto_urls: [],
    created_at: '2026-07-20T10:00:00.000Z',
    ...over,
  }
}

function comentario(over: Partial<ComentarioMensajePortal> = {}): ComentarioMensajePortal {
  return {
    id: 'h1', company_id: 'c1', mensaje_id: 'm1',
    autor_nombre: 'Administración', contenido: 'Ya hablamos con el vecino',
    foto_urls: [], es_interno: false, created_at: '2026-07-21T09:00:00.000Z',
    ...over,
  }
}

function renderTab(props: Partial<Parameters<typeof PortalMiUnidadTab>[0]> = {}) {
  return render(
    <PortalMiUnidadTab
      unidad={unidad}
      mensajes={[mensaje()]}
      proyectoId="p1"
      companyId="c1"
      isAdmin={false}
      autorNombre="Marco Santos"
      autorUserId="user-1"
      onRefresh={() => {}}
      onGenerarToken={() => {}}
      {...props}
    />,
  )
}

beforeEach(() => {
  mocks.createCondominioRow.mockClear()
  mocks.updateCondominioRow.mockClear()
  mocks.fetchComentariosMensajePortal.mockClear()
  mocks.fetchComentariosMensajePortal.mockResolvedValue([])
  mocks.fetchConteoComentariosMensajePortal.mockClear()
  mocks.fetchConteoComentariosMensajePortal.mockResolvedValue({})
})

afterEach(() => {
  cleanup()
})

describe('PortalMiUnidadTab — mensaje en ventana emergente', () => {
  it('no monta el formulario hasta pedirlo', () => {
    renderTab()
    expect(screen.queryByLabelText('Asunto *')).toBeNull()
  })

  it('abre el formulario como diálogo modal', () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Enviar mensaje'))
    const dialogo = screen.getByRole('dialog')
    expect(dialogo.getAttribute('aria-modal')).toBe('true')
    expect(dialogo.getAttribute('aria-label')).toBe('Enviar mensaje a la administración')
  })

  it('exige asunto y cuerpo antes de enviar', async () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Enviar mensaje'))
    fireEvent.change(screen.getByLabelText('Asunto *'), { target: { value: 'Solo asunto' } })
    fireEvent.click(screen.getByText('📤 Enviar'))
    await waitFor(() => expect(mocks.createCondominioRow).not.toHaveBeenCalled())
  })

  it('envía el mensaje con tipo y fotos, y cierra el diálogo', async () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Enviar mensaje'))
    fireEvent.change(screen.getByLabelText('Asunto *'), { target: { value: 'Fuga' } })
    fireEvent.change(screen.getByLabelText('Mensaje *'), { target: { value: 'Gotea el techo' } })
    fireEvent.click(screen.getByText('🚨 Emergencia'))
    fireEvent.click(screen.getByText('📤 Enviar'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('mensajes_portal')
    expect(payload).toMatchObject({
      company_id: 'c1', project_id: 'p1', unidad_id: 'u1',
      asunto: 'Fuga', cuerpo: 'Gotea el techo', tipo: 'emergencia',
    })
    expect(payload.foto_urls).toEqual([])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('PortalMiUnidadTab — conversación del mensaje', () => {
  it('muestra el conteo del hilo en la tarjeta', async () => {
    mocks.fetchConteoComentariosMensajePortal.mockResolvedValue({ m1: 2 })
    renderTab()
    expect(await screen.findByText('💬 Conversación (2)')).toBeTruthy()
  })

  it('abre el hilo y pinta los mensajes existentes', async () => {
    mocks.fetchComentariosMensajePortal.mockResolvedValue([comentario()])
    renderTab()
    fireEvent.click(screen.getByText('💬 Escribir a la administración'))

    expect(await screen.findByText('Ya hablamos con el vecino')).toBeTruthy()
    expect(mocks.fetchComentariosMensajePortal).toHaveBeenCalledWith('m1')
    expect(screen.getByText('Mensaje original')).toBeTruthy()
  })

  it('el residente responde sin marcar interno ni tocar el estado', async () => {
    renderTab()
    fireEvent.click(screen.getByText('💬 Escribir a la administración'))
    await screen.findByLabelText('Mensaje')

    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: 'Sigue igual' } })
    fireEvent.click(screen.getByText('➤ Enviar mensaje'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('comentarios_mensaje_portal')
    expect(payload).toMatchObject({
      mensaje_id: 'm1', company_id: 'c1',
      autor_nombre: 'Marco Santos', contenido: 'Sigue igual', es_interno: false,
    })
    // El residente no puede marcar notas internas ni mover el mensaje.
    expect(screen.queryByText('Nota interna')).toBeNull()
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('el staff responde y el mensaje pasa a respondido', async () => {
    renderTab({ isAdmin: true, autorNombre: 'Administración' })
    fireEvent.click(screen.getByText('💬 Responder'))
    await screen.findByLabelText('Mensaje')

    expect(screen.getByText('Nota interna')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: 'Lo revisamos hoy' } })
    fireEvent.click(screen.getByText('➤ Enviar mensaje'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, id, patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(tabla).toBe('mensajes_portal')
    expect(id).toBe('m1')
    expect(patch).toMatchObject({ estado: 'respondido' })
  })

  it('una nota interna del staff NO marca el mensaje como respondido', async () => {
    renderTab({ isAdmin: true, autorNombre: 'Administración' })
    fireEvent.click(screen.getByText('💬 Responder'))
    await screen.findByLabelText('Mensaje')

    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: 'Revisar con el guardia' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByText('➤ Enviar mensaje'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(payload.es_interno).toBe(true)
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })
})
