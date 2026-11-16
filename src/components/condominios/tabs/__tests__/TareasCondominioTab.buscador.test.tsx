// Tareas — el alta abre en ventana emergente (cerrar descarta el borrador) y el
// buscador se suma a los filtros: título, descripción, asignado, reportado, área
// y categoría, sin distinguir acentos. Los KPI de estado siguen contando todo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { AreaCondominio, TareaCondominio } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  updateCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  irATab: vi.fn(),
  onRefresh: vi.fn(),
}))
vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify, confirm: mocks.confirm }))

const TareasCondominioTab = (await import('../TareasCondominioTab')).default

const area = (id: string, nombre: string, icono: string): AreaCondominio => ({
  id, company_id: 'co1', project_id: 'p1', nombre, descripcion: null, icono, orden: 0, activo: true, created_at: '2026-01-01T00:00:00.000Z',
})
const areas = [area('area1', 'Piscina', '🏊'), area('area2', 'Lobby', '🚪')]
const tarea = (id: string, titulo: string, over: Partial<TareaCondominio> = {}): TareaCondominio => ({
  id, company_id: 'co1', project_id: 'p1', titulo, categoria: 'mantenimiento', prioridad: 'media', estado: 'pendiente',
  comentarios: [], created_at: '2026-01-01T00:00:00.000Z', ...over,
})
const tareas = [
  tarea('t1', 'Revisar bomba', { area_id: 'area1', area: 'Piscina', asignado_a: 'José' }),
  tarea('t2', 'Pulir piso', { area_id: 'area2', area: 'Lobby', descripcion: 'Encerar el mármol' }),
  tarea('t3', 'Pagar factura', { categoria: 'administrativa', reportado_por: 'Ana López' }),
]

function renderTab(props: Partial<Parameters<typeof TareasCondominioTab>[0]> = {}) {
  return render(
    <TareasCondominioTab tareas={tareas} areas={areas} proyectoId="p1" companyId="co1" moneda="Q"
      canCreate canEdit puedeConfigurarAreas onIrATab={mocks.irATab} onRefresh={mocks.onRefresh} {...props} />,
  )
}
const buscador = () => screen.getByRole('searchbox', { name: 'Buscar tarea' })
const visibles = () => tareas.map(t => t.titulo).filter(n => screen.queryByText(n))
/** El contador del KPI «Pendiente» (el número va justo antes de la etiqueta). */
const kpiPendiente = () => screen.getAllByText('Pendiente').map(e => e.previousElementSibling?.textContent).find(v => v && /^\d+$/.test(v))

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(() => { cleanup() })

describe('Tareas · buscador', () => {
  it('acota por título, descripción, asignado, reportado, área o categoría sin acentos; los KPI no cambian', () => {
    renderTab()
    expect(visibles()).toEqual(['Revisar bomba', 'Pulir piso', 'Pagar factura'])
    expect(screen.getByText('Tareas (3)')).toBeTruthy()
    expect(kpiPendiente()).toBe('3')

    fireEvent.change(buscador(), { target: { value: 'BOMBA' } })
    expect(visibles()).toEqual(['Revisar bomba'])
    expect(screen.getByText('Tareas (1)')).toBeTruthy()
    expect(kpiPendiente()).toBe('3')
    fireEvent.change(buscador(), { target: { value: 'marmol' } })
    expect(visibles()).toEqual(['Pulir piso'])
    fireEvent.change(buscador(), { target: { value: 'jose' } })
    expect(visibles()).toEqual(['Revisar bomba'])
    fireEvent.change(buscador(), { target: { value: 'lopez' } })
    expect(visibles()).toEqual(['Pagar factura'])
    fireEvent.change(buscador(), { target: { value: 'lobby' } })
    expect(visibles()).toEqual(['Pulir piso'])
    fireEvent.change(buscador(), { target: { value: 'administrativa' } })
    expect(visibles()).toEqual(['Pagar factura'])

    fireEvent.change(buscador(), { target: { value: 'zzz' } })
    expect(visibles()).toEqual([])
    expect(screen.getByText('Ninguna tarea coincide con «zzz»')).toBeTruthy()
    fireEvent.change(buscador(), { target: { value: '' } })
    expect(visibles()).toEqual(['Revisar bomba', 'Pulir piso', 'Pagar factura'])
  })

  it('se combina con el filtro de área y sin tareas conserva el mensaje de siempre', () => {
    renderTab()
    fireEvent.change(screen.getByLabelText('Filtrar por área'), { target: { value: 'area2' } })
    expect(visibles()).toEqual(['Pulir piso'])
    fireEvent.change(buscador(), { target: { value: 'bomba' } })
    expect(visibles()).toEqual([])
    expect(screen.getByText('Ninguna tarea coincide con «bomba»')).toBeTruthy()
    cleanup()
    renderTab({ tareas: [] })
    fireEvent.change(buscador(), { target: { value: 'bomba' } })
    expect(screen.getByText('Sin tareas')).toBeTruthy()
    expect(screen.queryByText(/Ninguna tarea coincide/)).toBeNull()
  })
})

describe('Tareas · alta en ventana emergente', () => {
  it('+ Nueva abre un diálogo sobre el detalle; Cancelar descarta el borrador y al reabrir sale en blanco', () => {
    renderTab()
    fireEvent.click(screen.getByText('Revisar bomba'))
    fireEvent.click(screen.getByText('+ Nueva'))
    const ventana = screen.getByRole('dialog', { name: 'Nueva tarea' })
    expect((within(ventana).getByLabelText('Título *') as HTMLInputElement).value).toBe('')
    // El detalle de la tarea elegida sigue detrás, y el botón de alta también.
    expect(screen.getByText('Comentarios (0)')).toBeTruthy()
    expect(screen.getByText('+ Nueva')).toBeTruthy()
    fireEvent.change(within(ventana).getByLabelText('Título *'), { target: { value: 'Borrador' } })
    fireEvent.change(within(ventana).getByLabelText('Asignado a'), { target: { value: 'Alguien' } })
    fireEvent.click(within(ventana).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('+ Nueva'))
    const ventana2 = screen.getByRole('dialog', { name: 'Nueva tarea' })
    expect((within(ventana2).getByLabelText('Título *') as HTMLInputElement).value).toBe('')
    expect((within(ventana2).getByLabelText('Asignado a') as HTMLInputElement).value).toBe('')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('✅ Crear tarea guarda con todos los campos etiquetados, cierra la ventana y refresca', async () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Nueva'))
    const ventana = screen.getByRole('dialog', { name: 'Nueva tarea' })
    fireEvent.change(within(ventana).getByLabelText('Título *'), { target: { value: 'Cambiar foco' } })
    fireEvent.change(within(ventana).getByLabelText('Categoría'), { target: { value: 'operativa' } })
    fireEvent.change(within(ventana).getByLabelText('Prioridad'), { target: { value: 'alta' } })
    fireEvent.change(within(ventana).getByLabelText('Área'), { target: { value: 'area2' } })
    fireEvent.change(within(ventana).getByLabelText('Fecha límite'), { target: { value: '2026-12-01' } })
    fireEvent.change(within(ventana).getByLabelText('Costo estimado (Q)'), { target: { value: '150' } })
    fireEvent.click(within(ventana).getByRole('button', { name: '✅ Crear tarea' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow.mock.calls[0]).toEqual(['tareas_condominio', expect.objectContaining({
      titulo: 'Cambiar foco', categoria: 'operativa', prioridad: 'alta', area_id: 'area2', area: 'Lobby',
      fecha_limite: '2026-12-01', costo_estimado: 150, estado: 'pendiente',
    })])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocks.onRefresh).toHaveBeenCalledTimes(1)
  })
})
