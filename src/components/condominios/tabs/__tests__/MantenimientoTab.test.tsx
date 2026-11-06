import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { TicketMantenimiento, Unidad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: false })),
  softDelete: vi.fn(async () => ({ error: null as { message: string } | null, count: 1 as number | null })),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../lib/storageUrls', () => ({ useSignedUrl: (src: string | null) => src }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
}))
vi.mock('../../../../lib/softDelete', () => ({ softDelete: mocks.softDelete }))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../exportUtils', () => ({ exportarPDFTabla: vi.fn(), exportarExcel: vi.fn() }))
vi.mock('../TicketChatModal', () => ({ TicketChatModal: ({ ticket }: { ticket: TicketMantenimiento }) => <div role="dialog" aria-label={`Chat ${ticket.titulo}`} /> }))

const { MantenimientoTab } = await import('../MantenimientoTab')

const ticket = {
  id: 't1', titulo: 'Fuga en el lobby', descripcion: 'Gotea del techo', tipo: 'correctivo', prioridad: 'urgente',
  estado: 'abierto', unidad_nombre: null, fecha_limite: '2026-10-25', costo_estimado: 450, costo_real: null,
  created_at: '2026-10-19T10:00:00Z', foto_urls: ['tickets/a.jpg', 'tickets/b.jpg'], archivo_urls: ['tickets/cotizacion.pdf'],
} as unknown as TicketMantenimiento

function renderTab(props: Partial<Parameters<typeof MantenimientoTab>[0]> = {}) {
  return render(
    <MantenimientoTab tickets={[ticket]} unidades={[] as Unidad[]} proyectoId="p1" companyId="co1" userId="u1"
      canCreate canEdit canDelete onRefresh={() => {}} {...props} />,
  )
}

// La tarjeta abre la ficha en ventana (EditModal real); estado, conversación y eliminar viven ahí.
const abrir = () => fireEvent.click(screen.getByRole('button', { name: 'Fuga en el lobby' }))
const ficha = () => screen.getByRole('dialog', { name: 'Fuga en el lobby' })
const pie = () => ficha().querySelector('.at-modal-footer') as HTMLElement

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('MantenimientoTab', () => {
  it('la tarjeta abre la ficha en ventana (pantalla completa en el teléfono) con fotos, documentos, aviso de vencido y acciones en el pie', () => {
    renderTab()
    expect(screen.queryByRole('dialog')).toBeNull()
    // La tarjeta es compacta: anuncia fotos y documentos pero no los despliega ni trae el selector de estado.
    expect(screen.getByText('📷 2')).toBeTruthy()
    expect(screen.getByText('📎 1')).toBeTruthy()
    expect(screen.queryByLabelText('Estado de Fuga en el lobby')).toBeNull()

    abrir()
    const v = ficha()
    expect(v.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(v).getByText('⚠️ Vencido · la fecha límite era 2026-10-25')).toBeTruthy()
    expect(within(v).getByText('Gotea del techo')).toBeTruthy()
    expect(within(v).getByText('450.00')).toBeTruthy()
    expect(within(v).getByText('Área común')).toBeTruthy()
    expect(within(v).getByText('Fotos (2)')).toBeTruthy()
    expect(within(v).getByText('Documentos (1)')).toBeTruthy()
    expect(within(v).getByLabelText('Estado de Fuga en el lobby')).toBeTruthy()
    expect(within(pie()).getAllByRole('button').map(b => b.textContent)).toEqual(['Cerrar', '🗑️ Eliminar', '💬 Conversación'])

    fireEvent.click(within(pie()).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    abrir()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sin permiso de edición la ficha no ofrece cambiar el estado, pero sí la conversación', () => {
    renderTab({ canEdit: false, canDelete: false })
    abrir()
    expect(within(ficha()).queryByLabelText('Estado de Fuga en el lobby')).toBeNull()
    expect(within(pie()).getAllByRole('button').map(b => b.textContent)).toEqual(['Cerrar', '💬 Conversación'])
  })

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

  it('desde la ficha se cambia el estado (la ficha sigue a la fila recargada) y se abre la conversación encima', async () => {
    const onRefresh = vi.fn()
    const { rerender } = renderTab({ onRefresh })
    expect(screen.getByText('📍 Área común')).toBeTruthy()
    abrir()
    fireEvent.change(within(ficha()).getByLabelText('Estado de Fuga en el lobby'), { target: { value: 'en_proceso' } })
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('tickets_mantenimiento', 't1', { estado: 'en_proceso' })
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    rerender(
      <MantenimientoTab tickets={[{ ...ticket, estado: 'en_proceso' }]} unidades={[] as Unidad[]} proyectoId="p1" companyId="co1" userId="u1"
        canCreate canEdit canDelete onRefresh={onRefresh} />,
    )
    expect((within(ficha()).getByLabelText('Estado de Fuga en el lobby') as HTMLSelectElement).value).toBe('en_proceso')

    fireEvent.click(within(pie()).getByRole('button', { name: '💬 Conversación' }))
    expect(screen.getByRole('dialog', { name: 'Chat Fuga en el lobby' })).toBeTruthy()
    // La ficha sigue abierta debajo de la conversación.
    expect(ficha()).toBeTruthy()
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
    abrir()
    expect(within(ficha()).queryByRole('button', { name: 'Eliminar Fuga en el lobby' })).toBeNull()
    cleanup()

    renderTab()
    abrir()
    fireEvent.click(within(pie()).getByRole('button', { name: 'Eliminar Fuga en el lobby' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  })

  it('con permiso de eliminar, aunque no edite, da de baja el ticket y cierra la ficha', async () => {
    mocks.confirm.mockResolvedValueOnce({ isConfirmed: true })
    const onRefresh = vi.fn()
    renderTab({ canEdit: false, onRefresh })
    abrir()
    fireEvent.click(within(pie()).getByRole('button', { name: 'Eliminar Fuga en el lobby' }))
    await waitFor(() => expect(mocks.softDelete).toHaveBeenCalledWith('tickets_mantenimiento', { id: 't1' }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('si la base no da de baja el ticket (la RLS lo rechaza), avisa, no lo da por eliminado y la ficha sigue abierta', async () => {
    mocks.confirm.mockResolvedValueOnce({ isConfirmed: true })
    mocks.softDelete.mockResolvedValueOnce({ error: null, count: 0 })
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    abrir()
    fireEvent.click(within(pie()).getByRole('button', { name: 'Eliminar Fuga en el lobby' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' })))
    expect(onRefresh).not.toHaveBeenCalled()
    expect(ficha()).toBeTruthy()
  })
})
