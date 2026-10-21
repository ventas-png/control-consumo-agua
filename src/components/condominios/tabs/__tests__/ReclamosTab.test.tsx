import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { ReclamoCondominio, Unidad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

const { ReclamosTab } = await import('../ReclamosTab')

const unidades = [{ id: 'un1', nombre: 'Casa 4', activo: true }] as unknown as Unidad[]

function reclamo(over: Partial<ReclamoCondominio> = {}): ReclamoCondominio {
  return {
    id: 'r1', unidad_id: 'un1', tipo: 'queja', asunto: 'Ruido de la piscina', descripcion: 'Música alta los sábados.',
    prioridad: 'alta', plazo_respuesta: null, anonimo: false, estado: 'recibido',
    respuesta_admin: null, respondido_por: null, fecha_respuesta: null, created_at: '2026-10-18T10:00:00Z',
    ...over,
  } as unknown as ReclamoCondominio
}

function renderTab(props: Partial<Parameters<typeof ReclamosTab>[0]> = {}) {
  return render(
    <ReclamosTab reclamos={[reclamo(), reclamo({ id: 'r2', asunto: 'Gracias por el jardín', tipo: 'sugerencia', estado: 'cerrado' })]}
      unidades={unidades} proyectoId="p1" companyId="co1" canCreate canEdit onRefresh={() => {}} {...props} />,
  )
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('ReclamosTab — ventanas', () => {
  it('el detalle se abre en ventana a pantalla completa en el teléfono', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /Ruido de la piscina/ }))
    const dialog = screen.getByRole('dialog', { name: /Ruido de la piscina/ })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText('Música alta los sábados.')).toBeTruthy()
    expect(within(dialog).getByText('Casa 4')).toBeTruthy()
  })

  it('responder desde la ventana guarda la respuesta y marca respondido', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: /Ruido de la piscina/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '✍️ Responder' }))
    fireEvent.change(within(dialog).getByLabelText('Respuesta *'), { target: { value: 'Hablaremos con el residente.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar respuesta' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('reclamos_condominio', 'r1', expect.objectContaining({
      respuesta_admin: 'Hablaremos con el residente.', estado: 'respondido',
    })))
    expect(onRefresh).toHaveBeenCalled()
  })

  it('los KPIs por estado filtran la lista', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /Cerrado/, pressed: false }))
    expect(screen.queryByRole('button', { name: /Ruido de la piscina/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Gracias por el jardín/ })).toBeTruthy()
    // Tocar el activo de nuevo vuelve a "Todos".
    fireEvent.click(screen.getByRole('button', { name: /Cerrado/, pressed: true }))
    expect(screen.getByRole('button', { name: /Ruido de la piscina/ })).toBeTruthy()
  })

  it('el formulario de nuevo reclamo es una ventana', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo' }))
    const dialog = screen.getByRole('dialog', { name: 'Nuevo reclamo / sugerencia' })
    fireEvent.change(within(dialog).getByLabelText('Asunto *'), { target: { value: 'Basura acumulada' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('reclamos_condominio', expect.objectContaining({ asunto: 'Basura acumulada' })))
  })

  it('sin permiso de edición la ventana es de solo lectura', () => {
    renderTab({ canEdit: false })
    fireEvent.click(screen.getByRole('button', { name: /Ruido de la piscina/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: '✍️ Responder' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /Editar/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'En revisión' })).toBeNull()
  })
})
