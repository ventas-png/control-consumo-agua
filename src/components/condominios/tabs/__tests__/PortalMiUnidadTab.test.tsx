import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
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
  fetchComentariosMensajePortal: mocks.fetchComentariosMensajePortal,
  fetchConteoComentariosMensajePortal: mocks.fetchConteoComentariosMensajePortal,
}))

const { PortalMiUnidadTab } = await import('../PortalMiUnidadTab')

const unidad = { id: 'u1', nombre: 'Apto. 2A', activo: true } as unknown as Unidad

function mensaje(over: Partial<MensajePortal> = {}): MensajePortal {
  return {
    id: 'm1', company_id: 'c1', project_id: 'p1', unidad_id: 'u1',
    asunto: 'Ruido en el pasillo', cuerpo: 'Todas las noches después de las 11',
    tipo: 'queja', estado: 'nuevo', foto_urls: [], archivo_urls: [],
    created_at: '2026-07-20T10:00:00.000Z',
    ...over,
  }
}

function comentario(over: Partial<ComentarioMensajePortal> = {}): ComentarioMensajePortal {
  return {
    id: 'h1', company_id: 'c1', mensaje_id: 'm1',
    autor_nombre: 'Administración', contenido: 'Ya hablamos con el vecino',
    foto_urls: [], archivo_urls: [], es_interno: false, created_at: '2026-07-21T09:00:00.000Z',
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

/** La tarjeta abre la ficha en ventana; el hilo vive en su pie. */
const abrirFicha = (asunto = 'Ruido en el pasillo') => fireEvent.click(screen.getByRole('button', { name: asunto }))
const ficha = (asunto = 'Ruido en el pasillo') => screen.getByRole('dialog', { name: asunto })
const pie = (asunto?: string) => ficha(asunto).querySelector('.at-modal-footer') as HTMLElement

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
    expect(payload.archivo_urls).toEqual([])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('ofrece adjuntar documentos además de fotos', () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Enviar mensaje'))
    expect(screen.getByText(/Documentos/)).toBeTruthy()
    expect(screen.getByText(/PDF, Word o Excel/)).toBeTruthy()
  })

  it('la tarjeta cuenta los documentos adjuntos y la ficha los lista', async () => {
    renderTab({ mensajes: [mensaje({ archivo_urls: ['p1/mensajes-portal/1785540000000-a3f9x2-contrato.pdf'] })] })
    expect(screen.getByText('📎 1 archivo')).toBeTruthy()
    expect(screen.queryByText('contrato.pdf')).toBeNull()
    abrirFicha()
    expect(await screen.findByText('contrato.pdf')).toBeTruthy()
  })
})

describe('PortalMiUnidadTab — conversación del mensaje', () => {
  it('muestra el conteo del hilo en la tarjeta y en el botón del pie de la ficha', async () => {
    mocks.fetchConteoComentariosMensajePortal.mockResolvedValue({ m1: 2 })
    renderTab()
    expect(await screen.findByText('💬 2')).toBeTruthy()
    abrirFicha()
    expect(within(pie()).getByRole('button', { name: '💬 Conversación (2)' })).toBeTruthy()
  })

  it('abre el hilo y pinta los mensajes existentes', async () => {
    mocks.fetchComentariosMensajePortal.mockResolvedValue([comentario()])
    renderTab()
    abrirFicha()
    fireEvent.click(within(pie()).getByRole('button', { name: '💬 Escribir a la administración' }))

    expect(await screen.findByText('Ya hablamos con el vecino')).toBeTruthy()
    expect(mocks.fetchComentariosMensajePortal).toHaveBeenCalledWith('m1')
    expect(screen.getByText('Mensaje original')).toBeTruthy()
  })

  it('el residente responde sin marcar interno ni tocar el estado', async () => {
    renderTab()
    abrirFicha()
    fireEvent.click(within(pie()).getByRole('button', { name: '💬 Escribir a la administración' }))
    await screen.findByLabelText('Mensaje')

    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: 'Sigue igual' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('comentarios_mensaje_portal')
    expect(payload).toMatchObject({
      mensaje_id: 'm1', company_id: 'c1',
      autor_nombre: 'Marco Santos', contenido: 'Sigue igual', es_interno: false,
    })
    // El residente no puede marcar notas internas ni mover el mensaje.
    expect(screen.queryByRole('radio', { name: /Nota interna/ })).toBeNull()
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('el staff responde y el mensaje pasa a respondido', async () => {
    renderTab({ isAdmin: true, autorNombre: 'Administración' })
    abrirFicha()
    fireEvent.click(within(pie()).getByRole('button', { name: '💬 Responder' }))
    await screen.findByLabelText('Mensaje')

    expect(screen.getByRole('radio', { name: /Nota interna/ })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: 'Lo revisamos hoy' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, id, patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(tabla).toBe('mensajes_portal')
    expect(id).toBe('m1')
    expect(patch).toMatchObject({ estado: 'respondido' })
  })

  it('una nota interna del staff NO marca el mensaje como respondido', async () => {
    renderTab({ isAdmin: true, autorNombre: 'Administración' })
    abrirFicha()
    fireEvent.click(within(pie()).getByRole('button', { name: '💬 Responder' }))
    await screen.findByLabelText('Mensaje')

    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: 'Revisar con el guardia' } })
    fireEvent.click(screen.getByRole('radio', { name: /Nota interna/ }))
    // Con "Nota interna" elegida, el botón deja claro que no le llega al residente.
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nota interna' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(payload.es_interno).toBe(true)
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })
})

describe('PortalMiUnidadTab — la ficha abre en ventana', () => {
  it('sin pulsar nada sólo hay tarjetas compactas; la tarjeta abre la ficha a pantalla completa en el teléfono', async () => {
    mocks.fetchConteoComentariosMensajePortal.mockResolvedValue({ m1: 2 })
    renderTab({ mensajes: [mensaje({ estado: 'respondido', respuesta: 'Ya hablamos con el vecino.', respondido_en: '2026-07-21T09:00:00.000Z', foto_urls: ['p1/mensajes-portal/a.jpg'] })] })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByText('💬 2')).toBeTruthy()
    expect(screen.getByText('📷 1 foto')).toBeTruthy()
    expect(screen.getByText('↩ Respondido')).toBeTruthy()
    // La respuesta completa sólo va en la ficha.
    expect(screen.queryByText('Ya hablamos con el vecino.')).toBeNull()

    abrirFicha()
    const v = ficha()
    expect(v.classList.contains('at-modal--fs-mobile')).toBe(true)
    // Estado: chip del subtítulo y tarjeta de datos. Tipo: chip "😤 Queja" y tarjeta.
    expect(within(v).getAllByText(/Respondido$/)).toHaveLength(2)
    expect(within(v).getAllByText(/Queja$/)).toHaveLength(2)
    expect(within(v).getByText(/20 de julio de 2026/)).toBeTruthy()
    expect(within(v).getByText(/21 de julio de 2026/)).toBeTruthy()
    expect(within(v).getByText('Todas las noches después de las 11')).toBeTruthy()
    expect(within(v).getByText('Respuesta de administración')).toBeTruthy()
    expect(within(v).getByText('Ya hablamos con el vecino.')).toBeTruthy()
    expect(within(v).getByText('Fotos')).toBeTruthy()
    expect(within(pie()).getAllByRole('button').map(b => b.textContent)).toEqual(['Cerrar', '💬 Conversación (2)'])
  })

  it('Cerrar, Escape y Enter; el hilo abre encima de la ficha y Escape cierra sólo el hilo; el staff ve Responder', async () => {
    mocks.fetchComentariosMensajePortal.mockResolvedValue([comentario()])
    renderTab()
    abrirFicha()
    fireEvent.click(within(pie()).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.keyDown(screen.getByRole('button', { name: 'Ruido en el pasillo' }), { key: 'Enter' })
    expect(ficha()).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    abrirFicha()
    fireEvent.click(within(pie()).getByRole('button', { name: '💬 Escribir a la administración' }))
    expect(await screen.findByText('Ya hablamos con el vecino')).toBeTruthy()
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    mocks.fetchConteoComentariosMensajePortal.mockClear()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(ficha()).toBeTruthy()
    // Al cerrar el hilo se recarga el conteo.
    await waitFor(() => expect(mocks.fetchConteoComentariosMensajePortal).toHaveBeenCalledTimes(1))
    cleanup()

    renderTab({ isAdmin: true, autorNombre: 'Administración' })
    abrirFicha()
    expect(within(pie()).getAllByRole('button').map(b => b.textContent)).toEqual(['Cerrar', '💬 Responder'])
  })
})
