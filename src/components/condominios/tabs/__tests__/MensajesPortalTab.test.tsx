import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { MensajePortal, Unidad } from '../../../../types'

// Mismo patrón que PortalMiUnidadTab.test: el tab entra a Supabase solo por la
// capa domain, así que se mockea ahí (y el cliente, que los adjuntos importan de
// forma transitiva) para ejercitar la UI sin red ni env vars.
const mocks = vi.hoisted(() => ({
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  createCondominioRow: vi.fn(async () => ({ error: null })),
  fetchComentariosMensajePortal: vi.fn(async () => []),
  fetchConteoComentariosMensajePortal: vi.fn(async () => ({} as Record<string, number>)),
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: () => ({}) },
  db: { from: () => ({}) },
}))
vi.mock('../../../../lib/storageUrls', () => ({
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

const { MensajesPortalTab } = await import('../MensajesPortalTab')

const unidades = [
  { id: 'u1', nombre: 'Apto. 2A', activo: true },
  { id: 'u2', nombre: 'Apto. 3B', activo: true },
] as unknown as Unidad[]

function mensaje(over: Partial<MensajePortal> = {}): MensajePortal {
  return {
    id: 'm1', company_id: 'c1', project_id: 'p1', unidad_id: 'u1',
    asunto: 'Ruido en el pasillo', cuerpo: 'Todas las noches después de las 11',
    tipo: 'queja', estado: 'nuevo', foto_urls: [], archivo_urls: [],
    created_at: '2026-07-20T10:00:00.000Z',
    ...over,
  }
}

function renderTab(props: Partial<Parameters<typeof MensajesPortalTab>[0]> = {}) {
  return render(
    <MensajesPortalTab
      mensajes={[mensaje()]}
      unidades={unidades}
      autorNombre="Administración"
      autorUserId="user-1"
      canEdit
      onRefresh={() => {}}
      {...props}
    />,
  )
}

beforeEach(() => {
  mocks.updateCondominioRow.mockClear()
  mocks.createCondominioRow.mockClear()
  mocks.fetchComentariosMensajePortal.mockClear()
  mocks.fetchComentariosMensajePortal.mockResolvedValue([])
  mocks.fetchConteoComentariosMensajePortal.mockClear()
  mocks.fetchConteoComentariosMensajePortal.mockResolvedValue({})
})

afterEach(() => {
  cleanup()
})

describe('MensajesPortalTab — bandeja del proyecto', () => {
  it('lista los mensajes de TODAS las unidades sin elegir una primero', () => {
    renderTab({ mensajes: [
      mensaje(),
      mensaje({ id: 'm2', unidad_id: 'u2', asunto: 'Fuga en el baño', unidad_nombre: 'Apto. 3B' }),
    ] })
    expect(screen.getByText('Ruido en el pasillo')).toBeTruthy()
    expect(screen.getByText('Fuga en el baño')).toBeTruthy()
    // La unidad se resuelve por el join y, si falta, por el catálogo de
    // unidades (el 🏠 acota la aserción a la tarjeta, no al filtro).
    expect(screen.getByText(/🏠 Apto\. 2A/)).toBeTruthy()
    expect(screen.getByText(/🏠 Apto\. 3B/)).toBeTruthy()
  })

  it('el filtro por defecto muestra lo pendiente y esconde cerrados', () => {
    renderTab({ mensajes: [
      mensaje(),
      mensaje({ id: 'm2', asunto: 'Consulta vieja', estado: 'cerrado' }),
    ] })
    expect(screen.getByText('Ruido en el pasillo')).toBeTruthy()
    expect(screen.queryByText('Consulta vieja')).toBeNull()

    fireEvent.click(screen.getByText('Todos'))
    expect(screen.getByText('Consulta vieja')).toBeTruthy()
  })

  it('pone las emergencias arriba aunque sean más viejas', () => {
    renderTab({ mensajes: [
      mensaje({ id: 'm2', asunto: 'Consulta de cuota', tipo: 'consulta', created_at: '2026-07-25T10:00:00.000Z' }),
      mensaje({ id: 'm1', asunto: 'Fuga de agua', tipo: 'emergencia', created_at: '2026-07-20T10:00:00.000Z' }),
    ] })
    const asuntos = screen.getAllByText(/Fuga de agua|Consulta de cuota/).map(n => n.textContent)
    expect(asuntos[0]).toBe('Fuga de agua')
  })

  it('filtra por texto del asunto o del cuerpo', () => {
    renderTab({ mensajes: [
      mensaje(),
      mensaje({ id: 'm2', asunto: 'Fuga en el baño', cuerpo: 'Gotea el techo' }),
    ] })
    fireEvent.change(screen.getByLabelText('Buscar mensajes'), { target: { value: 'gotea' } })
    expect(screen.getByText('Fuga en el baño')).toBeTruthy()
    expect(screen.queryByText('Ruido en el pasillo')).toBeNull()
  })

  it('abrir el hilo de un mensaje nuevo lo marca como leído', async () => {
    renderTab()
    fireEvent.click(screen.getByText('💬 Responder'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, id, patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(tabla).toBe('mensajes_portal')
    expect(id).toBe('m1')
    expect(patch).toEqual({ estado: 'leido' })
  })

  it('no re-marca leído un mensaje ya respondido', async () => {
    renderTab({ mensajes: [mensaje({ estado: 'respondido' })] })
    fireEvent.click(screen.getByText('Todos'))
    fireEvent.click(screen.getByText('💬 Responder'))

    await screen.findByText('Mensaje original')
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('cierra un mensaje desde la bandeja', async () => {
    renderTab()
    fireEvent.click(screen.getByText('✔ Cerrar'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [, , patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(patch).toEqual({ estado: 'cerrado' })
  })

  it('sin permiso de edición no ofrece acciones de estado ni caja de respuesta', () => {
    renderTab({ canEdit: false })
    expect(screen.queryByText('✔ Cerrar')).toBeNull()
    expect(screen.queryByText('👁 Marcar leído')).toBeNull()
    expect(screen.getByText('💬 Ver conversación')).toBeTruthy()
  })

  it('muestra el conteo del hilo en la tarjeta', async () => {
    mocks.fetchConteoComentariosMensajePortal.mockResolvedValue({ m1: 3 })
    renderTab()
    expect(await screen.findByText('💬 Conversación (3)')).toBeTruthy()
  })

  it('explica la bandeja vacía cuando no hay mensajes', () => {
    renderTab({ mensajes: [] })
    expect(screen.getByText('Sin mensajes del portal')).toBeTruthy()
  })
})
