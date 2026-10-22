import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { EventoComunidad, RegistroAsistenteEvento, Unidad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  upsertCondominioRow: vi.fn(async () => ({ error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
  upsertCondominioRow: mocks.upsertCondominioRow,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

const { EventosComunidadTab } = await import('../EventosComunidadTab')

const unidades = [
  { id: 'un1', nombre: 'Casa 4', activo: true },
  { id: 'un2', nombre: 'Casa 7', activo: true },
] as unknown as Unidad[]

function evento(over: Partial<EventoComunidad> = {}): EventoComunidad {
  return {
    id: 'e1', company_id: 'co1', project_id: 'p1', titulo: 'Noche de talentos', descripcion: null,
    tipo: 'cultural', fecha: '2026-11-07', hora_inicio: '19:00', hora_fin: '22:00', lugar: 'Salón comunal',
    capacidad_max: 80, estado: 'programado', asistentes_real: null, costo_estimado: null, created_at: '2026-10-01T10:00:00Z',
    ...over,
  } as unknown as EventoComunidad
}

const asistentes = [
  { id: 'a1', company_id: 'co1', evento_id: 'e1', unidad_id: 'un1', nombre: 'Lucía Pérez', num_personas: 3, confirmado: true, asistio: false, created_at: '2026-10-02T10:00:00Z' },
] as unknown as RegistroAsistenteEvento[]

function renderTab(props: Partial<Parameters<typeof EventosComunidadTab>[0]> = {}) {
  return render(
    <EventosComunidadTab eventos={[evento()]} asistentes={asistentes} unidades={unidades}
      proyectoId="p1" companyId="co1" canCreate canEdit canDelete onRefresh={() => {}} {...props} />,
  )
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('EventosComunidadTab — ventanas', () => {
  it('cada evento abre sus asistentes en ventana (pantalla completa en el teléfono)', () => {
    renderTab()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Noche de talentos/ }))

    const dialog = screen.getByRole('dialog', { name: 'Noche de talentos' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText('Asistentes (1)')).toBeTruthy()
    expect(within(dialog).getByText('Lucía Pérez')).toBeTruthy()
    expect(within(dialog).getByText('🏠 Casa 4')).toBeTruthy()
    expect(within(dialog).getByText('📍 Salón comunal')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('la ventana lee el evento vigente tras refrescar (no una copia vieja)', () => {
    const { rerender } = renderTab()
    fireEvent.click(screen.getByRole('button', { name: /^Noche de talentos/ }))
    expect(within(screen.getByRole('dialog')).getByText('Programado')).toBeTruthy()

    rerender(
      <EventosComunidadTab eventos={[evento({ titulo: 'Noche de talentos 2026', estado: 'en_curso' })]} asistentes={asistentes} unidades={unidades}
        proyectoId="p1" companyId="co1" canCreate canEdit canDelete onRefresh={() => {}} />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Noche de talentos 2026' })
    expect(within(dialog).getByText('En curso')).toBeTruthy()
  })

  it('agregar un asistente desde la ventana lo registra en ese evento', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: /^Noche de talentos/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '+ Agregar asistente' }))
    fireEvent.change(within(dialog).getByLabelText('Unidad'), { target: { value: 'un2' } })
    fireEvent.change(within(dialog).getByLabelText('Nombre contacto'), { target: { value: 'Marco Ruiz' } })
    fireEvent.change(within(dialog).getByLabelText('Nº personas'), { target: { value: '2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar asistente' }))

    await waitFor(() => expect(mocks.upsertCondominioRow).toHaveBeenCalledWith('registro_asistentes_evento', expect.objectContaining({
      evento_id: 'e1', unidad_id: 'un2', nombre: 'Marco Ruiz', num_personas: 2,
    }), 'evento_id,unidad_id'))
    expect(onRefresh).toHaveBeenCalled()
  })

  it('marcar asistencia desde la ventana actualiza el registro', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /^Noche de talentos/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sin confirmar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('registro_asistentes_evento', 'a1', { asistio: true }))
  })

  it('el formulario de nuevo evento es una ventana y guarda', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo Evento' }))
    const dialog = screen.getByRole('dialog', { name: 'Nuevo Evento' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Título *'), { target: { value: 'Torneo de fútbol' } })
    fireEvent.change(within(dialog).getByLabelText('Fecha *'), { target: { value: '2026-11-21' } })
    fireEvent.change(within(dialog).getByLabelText('Tipo'), { target: { value: 'deportivo' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('eventos_comunidad', expect.objectContaining({
      titulo: 'Torneo de fútbol', fecha: '2026-11-21', tipo: 'deportivo', company_id: 'co1', project_id: 'p1',
    })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('editar abre la ventana con los datos y actualiza el evento', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Editar Noche de talentos' }))
    const dialog = screen.getByRole('dialog', { name: 'Editar evento' })
    expect((within(dialog).getByLabelText('Título *') as HTMLInputElement).value).toBe('Noche de talentos')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('eventos_comunidad', 'e1', expect.objectContaining({ titulo: 'Noche de talentos' })))
  })

  it('sin permisos no hay acciones en la lista ni en la ventana', () => {
    renderTab({ canCreate: false, canEdit: false, canDelete: false })
    expect(screen.queryByRole('button', { name: '+ Nuevo Evento' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Iniciar' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Eliminar/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Noche de talentos/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: '+ Agregar asistente' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Sin confirmar' })).toBeNull()
    expect(within(dialog).getByText('Lucía Pérez')).toBeTruthy()
  })
})
