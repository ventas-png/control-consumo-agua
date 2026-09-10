// El área de una tarea se ELIGE del catálogo, no se transcribe.
//
// Antes era un input de texto libre ("Piscina, lobby…"): la misma piscina se
// escribía distinto en cada tarea y ninguna se podía cruzar con la limpieza ni
// con la ronda de esa área. Lo que se vigila aquí:
//
//   1. Que el formulario ofrezca el catálogo y NO acepte texto suelto.
//   2. Que el insert mande `area_id` (el vínculo) + `area` (el snapshot del
//      nombre), y ambos NULL cuando la tarea no tiene área — nunca texto suelto.
//   3. Que lo legado siga legible: una tarea con `area` pero sin `area_id` se
//      muestra con su texto y marcada como sin vincular.
//   4. Que el alta de áreas NO viva aquí: el tab manda al tab Áreas.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
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

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: () => ({}) },
  db: { from: () => ({}) },
}))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify, confirm: mocks.confirm }))

const TareasCondominioTab = (await import('../TareasCondominioTab')).default

function area(over: Partial<AreaCondominio> = {}): AreaCondominio {
  return {
    id: 'area1', company_id: 'co1', project_id: 'p1', nombre: 'Piscina',
    descripcion: null, icono: '🏊', orden: 0, activo: true,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function tarea(over: Partial<TareaCondominio> = {}): TareaCondominio {
  return {
    id: 't1', company_id: 'co1', project_id: 'p1', titulo: 'Revisar bomba',
    categoria: 'mantenimiento', prioridad: 'media', estado: 'pendiente',
    comentarios: [], created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function renderTab(props: Partial<Parameters<typeof TareasCondominioTab>[0]> = {}) {
  return render(
    <TareasCondominioTab
      tareas={[]}
      areas={[area(), area({ id: 'area2', nombre: 'Lobby', icono: '🚪', orden: 1 })]}
      proyectoId="p1"
      companyId="co1"
      moneda="Q"
      canCreate
      canEdit
      puedeConfigurarAreas
      onIrATab={mocks.irATab}
      onRefresh={mocks.onRefresh}
      {...props}
    />,
  )
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(() => { cleanup() })

describe('TareasCondominioTab — el área viene del catálogo', () => {
  it('el formulario ofrece las áreas del catálogo y no un campo de texto', () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Nueva'))

    // El placeholder del input libre anterior ya no existe en ningún lado.
    expect(screen.queryByPlaceholderText('Piscina, lobby…')).toBeNull()
    const opciones = screen.getAllByRole('option').map(o => o.textContent)
    expect(opciones).toContain('🏊 Piscina')
    expect(opciones).toContain('🚪 Lobby')
  })

  it('no ofrece las áreas inactivas al capturar', () => {
    renderTab({ areas: [area(), area({ id: 'area3', nombre: 'Bodega vieja', activo: false })] })
    fireEvent.click(screen.getByText('+ Nueva'))

    const opciones = screen.getAllByRole('option').map(o => o.textContent)
    expect(opciones).toContain('🏊 Piscina')
    expect(opciones.some(o => o?.includes('Bodega vieja'))).toBe(false)
  })

  it('guarda area_id (vínculo) y area (snapshot del nombre)', async () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Nueva'))
    fireEvent.change(screen.getByPlaceholderText('Descripción breve de la tarea'), { target: { value: 'Limpiar filtro' } })
    fireEvent.change(screen.getByLabelText('Filtrar por área'), { target: { value: '' } }) // el filtro no interfiere
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    const selectArea = selects.find(s => Array.from(s.options).some(o => o.textContent === '🏊 Piscina') && s.getAttribute('aria-label') !== 'Filtrar por área')!
    fireEvent.change(selectArea, { target: { value: 'area1' } })
    fireEvent.click(screen.getByText('✅ Crear tarea'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalled())
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('tareas_condominio')
    expect(payload.area_id).toBe('area1')
    expect(payload.area).toBe('Piscina')
  })

  it('sin área elegida manda area_id y area en NULL, nunca texto suelto', async () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Nueva'))
    fireEvent.change(screen.getByPlaceholderText('Descripción breve de la tarea'), { target: { value: 'Trámite bancario' } })
    fireEvent.click(screen.getByText('✅ Crear tarea'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalled())
    const [, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(payload.area_id).toBeNull()
    expect(payload.area).toBeNull()
  })

  it('muestra el nombre del catálogo en el detalle de la tarea vinculada', () => {
    renderTab({ tareas: [tarea({ area_id: 'area1', area: 'Piscina' })] })
    fireEvent.click(screen.getByText('Revisar bomba'))
    const chip = screen.getByTestId('tarea-area')
    expect(chip.textContent).toContain('🏊')
    expect(chip.textContent).toContain('Piscina')
    expect(chip.textContent).not.toContain('sin vincular')
  })

  it('una tarea legada conserva su texto y queda marcada como sin vincular', () => {
    renderTab({ tareas: [tarea({ area_id: null, area: 'piscina  vieja' })] })
    fireEvent.click(screen.getByText('Revisar bomba'))
    const chip = screen.getByTestId('tarea-area')
    expect(chip.textContent).toContain('piscina  vieja')
    expect(chip.textContent).toContain('sin vincular')
  })

  it('filtra la lista por área del catálogo', () => {
    renderTab({
      tareas: [
        tarea({ id: 't1', titulo: 'Revisar bomba', area_id: 'area1', area: 'Piscina' }),
        tarea({ id: 't2', titulo: 'Pulir piso', area_id: 'area2', area: 'Lobby' }),
      ],
    })
    fireEvent.change(screen.getByLabelText('Filtrar por área'), { target: { value: 'area2' } })
    expect(screen.getByText('Pulir piso')).toBeTruthy()
    expect(screen.queryByText('Revisar bomba')).toBeNull()
  })

  it('sin áreas en el catálogo, manda al tab Áreas en vez de dejar escribir una', () => {
    renderTab({ areas: [] })
    fireEvent.click(screen.getByText('+ Nueva'))
    expect(screen.queryByPlaceholderText('Piscina, lobby…')).toBeNull()

    fireEvent.click(screen.getByText('Crearlas en el tab Áreas'))
    expect(mocks.irATab).toHaveBeenCalledWith('areas_config')
  })

  it('sin visibilidad del tab Áreas no ofrece el atajo, solo dice dónde viven', () => {
    renderTab({ areas: [], puedeConfigurarAreas: false })
    fireEvent.click(screen.getByText('+ Nueva'))
    expect(screen.queryByText('Crearlas en el tab Áreas')).toBeNull()
    expect(screen.getByText(/Se dan de alta en el tab Áreas/)).toBeTruthy()
  })
})
