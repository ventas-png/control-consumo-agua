// Kanban de tickets: la tarjeta abre la ficha en ventana emergente (EditModal real, pantalla completa en el
// teléfono) con los datos del ticket y las acciones del flujo (retroceder / avanzar / cerrar) en el pie. Antes la
// tarjeta se expandía en sitio, con la descripción y los botones apretados dentro de la columna.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { TicketMantenimiento } from '../../../../types'

const mocks = vi.hoisted(() => ({
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  openPromptDialog: vi.fn(),
  notify: vi.fn(),
  onRefresh: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({ updateCondominioRow: mocks.updateCondominioRow }))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: mocks.openPromptDialog }))

const KanbanTicketsTab = (await import('../KanbanTicketsTab')).default

const ticket = (o: Partial<TicketMantenimiento>): TicketMantenimiento => ({
  id: 't?', company_id: 'co1', project_id: 'p1', tipo: 'correctivo', titulo: '?', prioridad: 'media', estado: 'abierto',
  foto_urls: [], archivo_urls: [], created_at: '2026-11-01T14:30:00Z', updated_at: '2026-11-01T14:30:00Z', ...o,
})
const FUGA = ticket({
  id: 't1', titulo: 'Fuga en bomba 2', prioridad: 'urgente', estado: 'en_proceso', unidad_nombre: 'Torre A · 101', asignado_a: 'Carlos Pérez',
  fecha_limite: '2026-11-10', costo_estimado: 1500, descripcion: 'Gotea por el sello mecánico.', foto_urls: ['a.jpg', 'b.jpg'],
})
const LUZ = ticket({ id: 't2', titulo: 'Luminaria pasillo', prioridad: 'baja', estado: 'abierto', tipo: 'preventivo' })
const PORTON = ticket({ id: 't3', titulo: 'Portón vehicular', prioridad: 'alta', estado: 'resuelto', costo_estimado: 800 })
const PINTURA = ticket({
  id: 't4', titulo: 'Pintura lobby', estado: 'cerrado', costo_estimado: 2000, costo_real: 1850, fecha_cierre: '2026-10-20T16:00:00Z', notas_cierre: 'Se pintó con esmalte.',
})
const TODOS = [FUGA, LUZ, PORTON, PINTURA]

function montar(p: { canEdit?: boolean; tickets?: TicketMantenimiento[] } = {}) {
  return render(
    <KanbanTicketsTab tickets={p.tickets ?? TODOS} proyectoId="p1" companyId="co1" moneda="Q" canEdit={p.canEdit ?? true} onRefresh={mocks.onRefresh} />,
  )
}
const abrir = (titulo = 'Fuga en bomba 2') => fireEvent.click(screen.getByRole('button', { name: titulo }))
const ficha = (titulo = 'Fuga en bomba 2') => screen.getByRole('dialog', { name: titulo })
const pie = (titulo?: string) => ficha(titulo).querySelector('.at-modal-footer') as HTMLElement
const botonesPie = (titulo?: string) => within(pie(titulo)).getAllByRole('button').map(b => b.textContent)

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('KanbanTicketsTab — la ficha abre en ventana', () => {
  it('sin pulsar nada sólo hay tarjetas en sus columnas; la tarjeta abre la ficha a pantalla completa en el teléfono', () => {
    montar()
    expect(screen.queryByRole('dialog')).toBeNull()
    TODOS.forEach(t => expect(screen.getByRole('button', { name: t.titulo })).toBeTruthy())
    // La descripción ya no se expande en sitio.
    expect(screen.queryByText('Gotea por el sello mecánico.')).toBeNull()

    abrir()
    const v = ficha()
    expect(v.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(v).getByText('📍 Torre A · 101')).toBeTruthy()
    expect(within(v).getByText('👤 Carlos Pérez')).toBeTruthy()
    // Prioridad: en el subtítulo (chip) y en la tarjeta de datos. Estado: en esos dos y en la línea del flujo.
    expect(within(v).getAllByText('Urgente')).toHaveLength(2)
    expect(within(v).getAllByText('En proceso')).toHaveLength(3)
    expect(within(v).getByText('🔧 Correctivo')).toBeTruthy()
    expect(within(v).getByText('2026-11-10')).toBeTruthy()
    expect(within(v).getByText('Q 1500.00')).toBeTruthy()
    expect(within(v).getByText('📷 2 fotos')).toBeTruthy()
    expect(within(v).getByText('Gotea por el sello mecánico.')).toBeTruthy()
    expect(botonesPie()).toEqual(['Cerrar', '← Retroceder', '→ Avanzar'])
  })

  it('Cerrar y Escape cierran la ficha; el pie cambia según la columna y sin permiso sólo queda Cerrar', () => {
    montar()
    abrir()
    fireEvent.click(within(pie()).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    abrir()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    abrir('Luminaria pasillo')
    expect(within(ficha('Luminaria pasillo')).getByText('🔩 Preventivo')).toBeTruthy()
    expect(botonesPie('Luminaria pasillo')).toEqual(['Cerrar', '→ Avanzar'])
    fireEvent.keyDown(document, { key: 'Escape' })

    abrir('Portón vehicular')
    expect(botonesPie('Portón vehicular')).toEqual(['Cerrar', '← Retroceder', '✅ Cerrar ticket'])
    fireEvent.keyDown(document, { key: 'Escape' })

    abrir('Pintura lobby')
    const cerrado = ficha('Pintura lobby')
    expect(within(cerrado).getByText('Q 1850.00')).toBeTruthy()
    expect(within(cerrado).getByText('Se pintó con esmalte.')).toBeTruthy()
    expect(botonesPie('Pintura lobby')).toEqual(['Cerrar', '← Retroceder'])
    cleanup()

    montar({ canEdit: false })
    abrir()
    expect(botonesPie()).toEqual(['Cerrar'])
  })

  it('Avanzar mueve el ticket, refresca y la ficha sigue a la fila recargada', async () => {
    const { rerender } = montar()
    abrir('Luminaria pasillo')
    fireEvent.click(within(pie('Luminaria pasillo')).getByRole('button', { name: '→ Avanzar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('tickets_mantenimiento', 't2', { estado: 'en_proceso' }))
    expect(mocks.openPromptDialog).not.toHaveBeenCalled()
    expect(mocks.onRefresh).toHaveBeenCalledTimes(1)

    rerender(
      <KanbanTicketsTab tickets={[FUGA, { ...LUZ, estado: 'en_proceso' }, PORTON, PINTURA]} proyectoId="p1" companyId="co1" moneda="Q" canEdit onRefresh={mocks.onRefresh} />,
    )
    expect(within(ficha('Luminaria pasillo')).getAllByText('En proceso')).toHaveLength(3)
    expect(botonesPie('Luminaria pasillo')).toEqual(['Cerrar', '← Retroceder', '→ Avanzar'])
  })

  it('Cerrar ticket pide notas y costo real en diálogos encima de la ficha; cancelar el primero no escribe', async () => {
    mocks.openPromptDialog.mockResolvedValueOnce({ notas: 'Se cambió el motor.' }).mockResolvedValueOnce({ costoReal: '920.50' })
    montar()
    abrir('Portón vehicular')
    fireEvent.click(within(pie('Portón vehicular')).getByRole('button', { name: '✅ Cerrar ticket' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.openPromptDialog.mock.calls.map(c => (c[0] as { title: string }).title)).toEqual(['Cerrar ticket', 'Costo real'])
    const [tabla, id, cambios] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Partial<TicketMantenimiento>]
    expect([tabla, id]).toEqual(['tickets_mantenimiento', 't3'])
    expect(cambios).toMatchObject({ estado: 'cerrado', notas_cierre: 'Se cambió el motor.', costo_real: 920.5 })
    expect(typeof cambios.fecha_cierre).toBe('string')
    expect(mocks.onRefresh).toHaveBeenCalledTimes(1)
    // La ficha sigue abierta sobre el tablero.
    expect(ficha('Portón vehicular')).toBeTruthy()

    mocks.updateCondominioRow.mockClear()
    mocks.openPromptDialog.mockResolvedValueOnce(null)
    fireEvent.click(within(pie('Portón vehicular')).getByRole('button', { name: '✅ Cerrar ticket' }))
    await waitFor(() => expect(mocks.openPromptDialog).toHaveBeenCalledTimes(3))
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('si la fila falla, avisa y no refresca', async () => {
    mocks.updateCondominioRow.mockResolvedValueOnce({ error: { message: 'sin permiso' } } as never)
    montar()
    abrir()
    fireEvent.click(within(pie()).getByRole('button', { name: '← Retroceder' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'sin permiso' })))
    expect(mocks.onRefresh).not.toHaveBeenCalled()
  })

  it('los filtros de prioridad y técnico dejan sólo esas tarjetas', () => {
    montar()
    fireEvent.change(screen.getByLabelText('Prioridad'), { target: { value: 'urgente' } })
    expect(screen.getByRole('button', { name: 'Fuga en bomba 2' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Luminaria pasillo' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Prioridad'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Técnico'), { target: { value: 'Carlos Pérez' } })
    expect(screen.getByRole('button', { name: 'Fuga en bomba 2' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Portón vehicular' })).toBeNull()
  })
})
