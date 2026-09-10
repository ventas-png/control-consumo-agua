// El área de una inspección se ELIGE del catálogo, no se transcribe.
//
// `checklist_areas.area` era el último texto libre de área del módulo (input
// con placeholder "Ej. Lobby, Piscina, Gimnasio"), así que lo inspeccionado no
// se podía cruzar con lo que la limpieza programa ni con lo que la ronda
// recorre. Lo que se vigila aquí:
//
//   1. Que el formulario ofrezca el catálogo y no acepte texto suelto.
//   2. Que el guardado mande `area_id` (el vínculo) + `area` (el snapshot del
//      nombre, que en esta tabla es NOT NULL).
//   3. Que un checklist LEGADO se pueda seguir editando sin perder su texto ni
//      quedar bloqueado, y que al elegir área quede vinculado.
//   4. Que el alta de áreas no viva aquí: el tab manda al tab Áreas.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { AreaCondominio, ChecklistArea } from '../../../../types'

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

const { ChecklistAreasTab } = await import('../ChecklistAreasTab')

function area(over: Partial<AreaCondominio> = {}): AreaCondominio {
  return {
    id: 'area1', company_id: 'co1', project_id: 'p1', nombre: 'Piscina',
    descripcion: null, icono: '🏊', orden: 0, activo: true,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function checklist(over: Partial<ChecklistArea> = {}): ChecklistArea {
  return {
    id: 'c1', company_id: 'co1', project_id: 'p1',
    area: 'Piscina', area_id: 'area1', fecha: '2026-09-01',
    inspector: 'Ana', items: [], estado: 'pendiente',
    created_at: '2026-09-01T00:00:00.000Z',
    ...over,
  }
}

function renderTab(props: Partial<Parameters<typeof ChecklistAreasTab>[0]> = {}) {
  return render(
    <ChecklistAreasTab
      checklists={[]}
      areas={[area(), area({ id: 'area2', nombre: 'Lobby', icono: '🚪', orden: 1 })]}
      proyectoId="p1"
      companyId="co1"
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

describe('ChecklistAreasTab — el área viene del catálogo', () => {
  it('el formulario ofrece el catálogo y no un campo de texto', () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Nuevo checklist'))

    expect(screen.queryByPlaceholderText('Ej. Lobby, Piscina, Gimnasio')).toBeNull()
    const opciones = Array.from((screen.getByLabelText('Área') as HTMLSelectElement).options).map(o => o.textContent)
    expect(opciones).toContain('🏊 Piscina')
    expect(opciones).toContain('🚪 Lobby')
  })

  it('no ofrece las áreas inactivas al capturar', () => {
    renderTab({ areas: [area(), area({ id: 'area3', nombre: 'Bodega vieja', activo: false })] })
    fireEvent.click(screen.getByText('+ Nuevo checklist'))

    const opciones = Array.from((screen.getByLabelText('Área') as HTMLSelectElement).options).map(o => o.textContent)
    expect(opciones.some(o => o?.includes('Bodega vieja'))).toBe(false)
  })

  it('guarda area_id (vínculo) y area (snapshot del nombre)', async () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Nuevo checklist'))
    fireEvent.change(screen.getByLabelText('Área'), { target: { value: 'area2' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalled())
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('checklist_areas')
    expect(payload.area_id).toBe('area2')
    expect(payload.area).toBe('Lobby')
  })

  it('sin área elegida no guarda: pide elegirla del catálogo', async () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Nuevo checklist'))
    fireEvent.click(screen.getByText('Guardar'))

    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('Selecciona el área del catálogo'),
    }))
  })

  it('muestra el nombre del catálogo, no el snapshot, cuando el área se renombró', () => {
    renderTab({
      // La fila guardó "Piscina" y luego el catálogo pasó a "Piscina techada".
      checklists: [checklist({ area: 'Piscina' })],
      areas: [area({ nombre: 'Piscina techada' })],
    })
    fireEvent.click(screen.getByText(/2026-09-01/))
    expect(screen.getByTestId('checklist-area').textContent).toContain('Piscina techada')
  })

  it('un checklist legado conserva su texto y queda marcado como sin vincular', () => {
    renderTab({ checklists: [checklist({ area_id: null, area: 'gimnasio  viejo' })] })
    fireEvent.click(screen.getByText(/2026-09-01/))
    expect(screen.getByTestId('checklist-area').textContent).toContain('gimnasio  viejo')
    expect(screen.getByText(/⚠ sin vincular/)).toBeTruthy()
  })

  it('editar un legado sin elegir área conserva el texto en lugar de bloquear', async () => {
    renderTab({ checklists: [checklist({ area_id: null, area: 'gimnasio viejo' })] })
    fireEvent.click(screen.getByText(/2026-09-01/))
    fireEvent.click(screen.getByText('✏️ Editar'))
    expect(screen.getByText(/Registro anterior con texto libre/)).toBeTruthy()

    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalled())
    const [, , payload] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(payload.area).toBe('gimnasio viejo')
    expect(payload.area_id).toBeNull()
  })

  it('editar un legado eligiendo área lo vincula y actualiza el snapshot', async () => {
    renderTab({ checklists: [checklist({ area_id: null, area: 'gimnasio viejo' })] })
    fireEvent.click(screen.getByText(/2026-09-01/))
    fireEvent.click(screen.getByText('✏️ Editar'))
    fireEvent.change(screen.getByLabelText('Área'), { target: { value: 'area1' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalled())
    const [, , payload] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(payload.area_id).toBe('area1')
    expect(payload.area).toBe('Piscina')
  })

  it('filtra la lista por área del catálogo', () => {
    renderTab({
      checklists: [
        checklist({ id: 'c1', area_id: 'area1', area: 'Piscina', inspector: 'Ana' }),
        checklist({ id: 'c2', area_id: 'area2', area: 'Lobby', inspector: 'Beto' }),
      ],
    })
    fireEvent.change(screen.getByLabelText('Filtrar por área'), { target: { value: 'area2' } })
    expect(screen.getByText(/Beto/)).toBeTruthy()
    expect(screen.queryByText(/Ana/)).toBeNull()
  })

  it('sin áreas en el catálogo, manda al tab Áreas en vez de dejar escribir una', () => {
    renderTab({ areas: [] })
    fireEvent.click(screen.getByText('+ Nuevo checklist'))
    expect(screen.queryByPlaceholderText('Ej. Lobby, Piscina, Gimnasio')).toBeNull()

    fireEvent.click(screen.getByText('Crearlas en el tab Áreas'))
    expect(mocks.irATab).toHaveBeenCalledWith('areas_config')
  })

  it('sin visibilidad del tab Áreas no ofrece el atajo, solo dice dónde viven', () => {
    renderTab({ areas: [], puedeConfigurarAreas: false })
    fireEvent.click(screen.getByText('+ Nuevo checklist'))
    expect(screen.queryByText('Crearlas en el tab Áreas')).toBeNull()
    expect(screen.getByText(/Se dan de alta en el tab Áreas/)).toBeTruthy()
  })
})
