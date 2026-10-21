import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { TicketMantenimiento, Unidad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: false })),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../lib/storageUrls', () => ({ useSignedUrl: (src: string | null) => src }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../exportUtils', () => ({ exportarPDFTabla: vi.fn(), exportarExcel: vi.fn() }))
vi.mock('../TicketChatModal', () => ({ TicketChatModal: ({ ticket }: { ticket: TicketMantenimiento }) => <div role="dialog" aria-label={`Chat ${ticket.titulo}`} /> }))

const { MantenimientoTab } = await import('../MantenimientoTab')

const ticket = {
  id: 't1', titulo: 'Fuga en el lobby', descripcion: 'Gotea del techo', tipo: 'correctivo', prioridad: 'urgente',
  estado: 'abierto', unidad_nombre: null, fecha_limite: null, costo_estimado: null, costo_real: null,
  created_at: '2026-10-19T10:00:00Z', foto_urls: [], archivo_urls: [],
} as unknown as TicketMantenimiento

function renderTab(props: Partial<Parameters<typeof MantenimientoTab>[0]> = {}) {
  return render(
    <MantenimientoTab tickets={[ticket]} unidades={[] as Unidad[]} proyectoId="p1" companyId="co1" userId="u1"
      canCreate canEdit canDelete onRefresh={() => {}} {...props} />,
  )
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('MantenimientoTab', () => {
  it('el nuevo ticket se llena en una ventana a pantalla completa en el teléfono', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo ticket' }))
    const dialog = screen.getByRole('dialog', { name: 'Nuevo ticket de mantenimiento' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Título *'), { target: { value: 'Bombilla quemada' } })
    fireEvent.change(within(dialog).getByLabelText('Prioridad'), { target: { value: 'alta' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear ticket' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('tickets_mantenimiento', expect.objectContaining({ titulo: 'Bombilla quemada', prioridad: 'alta' })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('cada ticket tiene la conversación a todo el ancho y el estado con su etiqueta', () => {
    renderTab()
    expect(screen.getByText('📍 Área común')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Estado de Fuga en el lobby'), { target: { value: 'en_proceso' } })
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('tickets_mantenimiento', 't1', { estado: 'en_proceso' })
    fireEvent.click(screen.getByRole('button', { name: '💬 Conversación' }))
    expect(screen.getByRole('dialog', { name: 'Chat Fuga en el lobby' })).toBeTruthy()
  })

  it('los filtros dicen cuál está activo', () => {
    renderTab()
    const estados = screen.getByRole('group', { name: 'Filtrar por estado' })
    expect(within(estados).getByRole('button', { name: 'Activos' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(estados).getByRole('button', { name: 'Cerrado' }))
    expect(screen.getByText('No hay tickets de mantenimiento')).toBeTruthy()
  })

  it('eliminar exige su propio permiso: editar no basta', async () => {
    renderTab({ canDelete: false })
    expect(screen.queryByRole('button', { name: 'Eliminar Fuga en el lobby' })).toBeNull()
    cleanup()

    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Fuga en el lobby' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  })
})
