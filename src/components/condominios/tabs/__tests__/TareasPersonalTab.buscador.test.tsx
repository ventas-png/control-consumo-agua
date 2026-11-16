// Tareas por turno — el buscador acota los turnos pintados por empleado, cargo,
// turno o título de alguna tarea, sin distinguir acentos; «+ Asignar turno» y
// «+ Agregar tarea» abren en ventana emergente y cerrar descarta el borrador.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type {
  AreaCondominio, BloqueTurno, PersonalCondominio, PlantillaTareaCargo, TareaBloque,
} from '../../../../types'

type RowError = { message: string; code?: string } | null

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null as RowError })),
  createCondominioRowReturning: vi.fn(async () => ({ data: null as { id: string } | null, error: null as RowError })),
  updateCondominioRow: vi.fn(async () => ({ error: null as RowError })),
  deleteCondominioRow: vi.fn(async () => ({ error: null as RowError })),
  cerrarTareaYConsumir: vi.fn(async () => ({ data: { consumidos: 0, no_usados: 0, sin_stock: [] as unknown[] }, error: null as RowError })),
  fetchInsumosDeTareas: vi.fn(async () => ({ insumos: [] as unknown[], error: null })),
  fetchHerramientasDePlantillas: vi.fn(async () => ({ herramientas: [] as unknown[], error: null as { message: string } | null })),
  openPromptDialog: vi.fn(async () => null as Record<string, string> | null),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  createCondominioRowReturning: mocks.createCondominioRowReturning,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
  cerrarTareaYConsumir: mocks.cerrarTareaYConsumir,
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({
  fetchInsumosDeTareas: mocks.fetchInsumosDeTareas,
  fetchHerramientasDePlantillas: mocks.fetchHerramientasDePlantillas,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: mocks.openPromptDialog }))
vi.mock('../../../shared/ImageUploader', () => ({ MultiImageUploader: () => null, ImageUploader: () => null }))

const { TareasPersonalTab } = await import('../TareasPersonalTab')

const HOY = new Date().toISOString().slice(0, 10)
const persona = (id: string, nombre: string, cargo: string) =>
  ({ id, company_id: 'co1', project_id: 'p1', nombre, cargo, turno: 'diurno', estado: 'activo', created_at: '' } as PersonalCondominio)
const personal = [persona('per1', 'Dina', 'conserje'), persona('per2', 'Pedro López', 'guardia')]
const bloque = (id: string, personal_id: string, turno: BloqueTurno['turno']) =>
  ({ id, company_id: 'co1', project_id: 'p1', personal_id, turno, fecha: HOY, estado: 'pendiente', foto_urls: [], created_at: '' } as unknown as BloqueTurno)
const bloques = [bloque('blo1', 'per1', 'manana'), bloque('blo2', 'per2', 'noche')]
const tarea = (id: string, bloque_id: string, titulo: string) =>
  ({ id, bloque_id, titulo, orden: 0, requiere_foto: false, estado: 'pendiente', foto_urls: [], created_at: '' } as TareaBloque)
const tareas = [tarea('t1', 'blo1', 'Barrer pasillo'), tarea('t2', 'blo2', 'Ronda nocturna')]
const areas = [{ id: 'a1', nombre: 'Lobby', icono: '🏢', activo: true }] as AreaCondominio[]
const plantillas = [{ id: 'pl1', cargo: 'conserje', titulo: 'Limpiar vidrios', descripcion: null, area_id: null, requiere_foto: true, activo: true, orden: 1 }] as unknown as PlantillaTareaCargo[]

function montar(over: Partial<Parameters<typeof TareasPersonalTab>[0]> = {}) {
  const onRefresh = vi.fn()
  render(
    <TareasPersonalTab bloques={bloques} tareas={tareas} plantillas={plantillas} personal={personal} areas={areas}
      proyectoId="p1" companyId="co1" userId="u1" canCreate canEdit canDelete onRefresh={onRefresh} {...over} />,
  )
  return { onRefresh }
}
const buscador = () => screen.getByRole('searchbox', { name: 'Buscar turno' })
// Sólo las cabeceras de tarjeta: los <option> del filtro y del formulario repiten «Nombre — Cargo».
const visibles = () => ['Dina', 'Pedro López'].filter(n =>
  screen.queryAllByText(new RegExp(`^${n} — `)).some(el => el.tagName !== 'OPTION'))

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockClear())
  mocks.createCondominioRow.mockResolvedValue({ error: null })
  mocks.createCondominioRowReturning.mockResolvedValue({ data: null, error: null })
})
afterEach(() => { cleanup() })

describe('Tareas por turno · buscador', () => {
  it('acota los turnos por empleado, cargo, turno o título de tarea, sin distinguir acentos', () => {
    montar()
    expect(visibles()).toEqual(['Dina', 'Pedro López'])
    fireEvent.change(buscador(), { target: { value: 'LOPEZ' } })
    expect(visibles()).toEqual(['Pedro López'])
    fireEvent.change(buscador(), { target: { value: 'conserje' } })
    expect(visibles()).toEqual(['Dina'])
    fireEvent.change(buscador(), { target: { value: 'noche' } })
    expect(visibles()).toEqual(['Pedro López'])
    // Por el título de una tarea del turno: ¿quién tiene hoy la ronda?
    fireEvent.change(buscador(), { target: { value: 'ronda' } })
    expect(visibles()).toEqual(['Pedro López'])
    fireEvent.change(buscador(), { target: { value: 'zzz' } })
    expect(visibles()).toEqual([])
    expect(screen.getByText('Ningún turno coincide con «zzz»')).toBeTruthy()
    fireEvent.change(buscador(), { target: { value: '' } })
    expect(visibles()).toEqual(['Dina', 'Pedro López'])
  })

  it('sin turnos para el filtro manda el estado vacío de siempre, no el del buscador', () => {
    montar({ bloques: [] })
    fireEvent.change(buscador(), { target: { value: 'dina' } })
    expect(screen.getByText('Sin turnos asignados para este filtro')).toBeTruthy()
    expect(screen.queryByText(/Ningún turno coincide/)).toBeNull()
  })
})

describe('Tareas por turno · formularios en ventana emergente', () => {
  it('+ Asignar turno abre un diálogo; Cancelar descarta el borrador; Crear turno guarda y cierra', async () => {
    const { onRefresh } = montar()
    fireEvent.click(screen.getByText('+ Asignar turno'))
    const ventana = screen.getByRole('dialog', { name: 'Asignar turno' })
    const empleado = within(ventana).getByLabelText('Empleado *') as HTMLSelectElement
    expect(empleado.value).toBe('')
    fireEvent.change(empleado, { target: { value: 'per2' } })
    fireEvent.change(within(ventana).getByLabelText('Notas'), { target: { value: 'Borrador' } })
    // Los turnos siguen detrás y el botón de alta sigue a la vista.
    expect(screen.getByText('+ Asignar turno')).toBeTruthy()
    expect(visibles()).toEqual(['Dina', 'Pedro López'])
    fireEvent.click(within(ventana).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.createCondominioRowReturning).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('+ Asignar turno'))
    const ventana2 = screen.getByRole('dialog', { name: 'Asignar turno' })
    expect((within(ventana2).getByLabelText('Empleado *') as HTMLSelectElement).value).toBe('')
    expect((within(ventana2).getByLabelText('Notas') as HTMLInputElement).value).toBe('')
    fireEvent.change(within(ventana2).getByLabelText('Empleado *'), { target: { value: 'per1' } })
    fireEvent.change(within(ventana2).getByLabelText('Turno'), { target: { value: 'tarde' } })
    fireEvent.click(within(ventana2).getByRole('button', { name: 'Crear turno' }))
    await waitFor(() => expect(mocks.createCondominioRowReturning).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRowReturning.mock.calls[0]).toEqual(['bloques_turno', expect.objectContaining({ personal_id: 'per1', turno: 'tarde', fecha: HOY, notas: null })])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('+ Agregar tarea abre un diálogo con el turno en el subtítulo; la plantilla rellena y Agregar guarda', async () => {
    const { onRefresh } = montar({ bloques: [bloques[0]], tareas: [tareas[0]] })
    fireEvent.click(screen.getByText('▾'))
    fireEvent.click(screen.getByText('+ Agregar tarea'))
    const ventana = screen.getByRole('dialog', { name: 'Agregar tarea al turno' })
    expect(within(ventana).getByText(/^Dina · Mañana · /)).toBeTruthy()
    // Tarea personalizada: título a mano; Cancelar lo descarta.
    fireEvent.change(within(ventana).getByLabelText('Título *'), { target: { value: 'Borrador' } })
    fireEvent.click(within(ventana).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('+ Agregar tarea'))
    const ventana2 = screen.getByRole('dialog', { name: 'Agregar tarea al turno' })
    expect((within(ventana2).getByLabelText('Título *') as HTMLInputElement).value).toBe('')
    fireEvent.change(within(ventana2).getByLabelText('Desde plantilla'), { target: { value: 'pl1' } })
    // Con plantilla el título sale de ella y el campo desaparece.
    expect(within(ventana2).queryByLabelText('Título *')).toBeNull()
    fireEvent.click(within(ventana2).getByRole('button', { name: 'Agregar' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow.mock.calls[0]).toEqual(['tareas_bloque', expect.objectContaining({ bloque_id: 'blo1', plantilla_id: 'pl1', titulo: 'Limpiar vidrios', requiere_foto: true, orden: 1 })])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('en la ruta del día (modoRuta) no hay alta, pero el buscador sigue', () => {
    montar({ modoRuta: { titulo: 'Ruta del día', onFechaChange: () => {} } })
    expect(screen.queryByText('+ Asignar turno')).toBeNull()
    fireEvent.change(buscador(), { target: { value: 'dina' } })
    expect(visibles()).toEqual(['Dina'])
  })
})
