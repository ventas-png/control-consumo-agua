// Catálogo de actividades — carga masiva y recursos EN BLOQUE desde las tarjetas: casillas solo
// con permiso de editar (nunca en consulta ni en modo selector), «Seleccionar todas» sobre las
// tarjetas visibles (respeta los filtros), la barra de selección abre el modal y el modal manda
// UNA llamada atómica con los ids y los recursos elegidos; agregar y quitar; errores sin prefijo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { AreaCondominio, ItemInventario, PlantillaTareaCargo, SuministroCondominio } from '../../../types'

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  fetchRecursosPlantillas: vi.fn(async () => ({ suministros: [], herramientas: [], error: null })),
  openPromptDialog: vi.fn(async () => null),
  confirm: vi.fn(async (_o: { text?: string; variant?: string }) => ({ isConfirmed: true })),
  notify: vi.fn(),
}))
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: m.rpc, from: () => ({}) }, db: { from: () => ({}) }, warmUpSupabase: vi.fn() }))
vi.mock('../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: m.createCondominioRow, updateCondominioRow: m.updateCondominioRow, deleteCondominioRow: m.deleteCondominioRow,
}))
vi.mock('../../../domain/condominios/tabQueries', () => ({ fetchRecursosPlantillas: m.fetchRecursosPlantillas }))
vi.mock('../../shared/Dialog', () => ({ confirm: m.confirm, notify: m.notify }))
vi.mock('../../shared/PromptDialog', () => ({ openPromptDialog: m.openPromptDialog }))

const { ActividadesCatalog } = await import('../ActividadesCatalog')

function plantilla(id: string, titulo: string, over: Partial<PlantillaTareaCargo> = {}): PlantillaTareaCargo {
  return {
    id, company_id: 'co1', project_id: 'p1', cargo: 'conserje', titulo, descripcion: null, icono: '🧹', orden: 0,
    area_id: null, requiere_foto: false, activo: true, created_at: '2026-01-01T00:00:00.000Z', servicio: 'limpieza',
    duracion_estimada_min: 10, checklist: [], ...over,
  }
}
const plantillas = [
  plantilla('pl1', 'Barrido'),
  plantilla('pl2', 'Trapeado'),
  plantilla('pl3', 'Ronda', { cargo: 'guardia', servicio: 'seguridad', icono: '🔐' }),
]
const areas: AreaCondominio[] = []
const suministros: SuministroCondominio[] = [
  { id: 's1', company_id: 'co1', project_id: 'p1', nombre: 'Escoba', categoria: 'limpieza', unidad_medida: 'unidad', stock_actual: 1, stock_minimo: 0, activo: true, created_at: '' } as SuministroCondominio,
  { id: 's2', company_id: 'co1', project_id: 'p1', nombre: 'Cloro', categoria: 'limpieza', unidad_medida: 'litro', stock_actual: 1, stock_minimo: 0, activo: false, created_at: '' } as SuministroCondominio,
]
const inventario: ItemInventario[] = [
  { id: 'i1', company_id: 'co1', project_id: 'p1', nombre: 'Trapeador', categoria: 'herramienta', estado: 'disponible', cantidad: 1, cantidad_minima: 0, unidad_medida: 'unidad', created_at: '' } as ItemInventario,
  { id: 'i2', company_id: 'co1', project_id: 'p1', nombre: 'Hidrolavadora', categoria: 'equipo', estado: 'disponible', cantidad: 1, cantidad_minima: 0, unidad_medida: 'unidad', created_at: '' } as ItemInventario,
  { id: 'i3', company_id: 'co1', project_id: 'p1', nombre: 'Aspiradora', categoria: 'equipo', estado: 'dado_de_baja', cantidad: 1, cantidad_minima: 0, unidad_medida: 'unidad', created_at: '' } as ItemInventario,
]

function abrir(over: Partial<Parameters<typeof ActividadesCatalog>[0]> = {}) {
  const onRefresh = vi.fn()
  render(<ActividadesCatalog plantillas={plantillas} areas={areas} suministros={suministros} inventario={inventario}
    proyectoId="p1" companyId="co1" canCreate canEdit canDelete onRefresh={onRefresh} {...over} />)
  return { onRefresh }
}
const resultado = (over: Record<string, unknown> = {}) => ({
  accion: 'agregar', plantillas: 2, recursos: 2, pares: 4, agregados: 3, ya_estaban: 1, quitados: 0, no_estaban: 0, ...over,
})

beforeEach(() => { m.confirm.mockResolvedValue({ isConfirmed: true }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Catálogo de actividades · carga masiva y recursos en bloque', () => {
  it('con permiso de crear ofrece «Carga masiva» y abre el modal de importación', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: '⬆️ Carga masiva' }))
    expect(await screen.findByText(/Carga masiva de actividades/)).toBeTruthy()
    expect(screen.getByLabelText('Archivo de actividades')).toBeTruthy()
  })

  it('en consulta o en modo selector no hay casillas, ni «Seleccionar todas», ni carga masiva', () => {
    abrir({ soloLectura: true })
    expect(screen.queryByLabelText('Seleccionar Barrido')).toBeNull()
    expect(screen.queryByLabelText('Seleccionar todas las actividades visibles')).toBeNull()
    expect(screen.queryByRole('button', { name: '⬆️ Carga masiva' })).toBeNull()
    cleanup()
    abrir({ seleccion: { yaElegidas: new Set(), onElegir: vi.fn() } })
    expect(screen.queryByLabelText('Seleccionar Barrido')).toBeNull()
    expect(screen.queryByRole('button', { name: '⬆️ Carga masiva' })).toBeNull()
    cleanup()
    abrir({ canEdit: false })
    expect(screen.queryByLabelText('Seleccionar Barrido')).toBeNull()
    expect(screen.getByRole('button', { name: '⬆️ Carga masiva' })).toBeTruthy()
  })

  it('«Seleccionar todas» marca solo las tarjetas visibles con el filtro activo y la barra muestra el conteo', () => {
    abrir()
    fireEvent.click(screen.getByText('Guardia (1)'))
    fireEvent.click(screen.getByLabelText('Seleccionar todas las actividades visibles'))
    expect(screen.getByRole('toolbar', { name: '1 actividad seleccionado' })).toBeTruthy()
    fireEvent.click(screen.getByText('Todos (3)'))
    expect(screen.getByTestId('actividad-pl3').getAttribute('data-seleccionada')).toBe('si')
    expect(screen.getByTestId('actividad-pl1').getAttribute('data-seleccionada')).toBeNull()
    fireEvent.click(screen.getByLabelText('Seleccionar Barrido'))
    expect(screen.getByRole('toolbar', { name: '2 actividades seleccionados' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar selección' }))
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('agregar en bloque: elige insumo con cantidad y equipo obligatorio, confirma, manda UNA RPC con los ids y recarga', async () => {
    m.rpc.mockResolvedValueOnce({ data: resultado(), error: null })
    abrir()
    fireEvent.click(screen.getByLabelText('Seleccionar Barrido'))
    fireEvent.click(screen.getByLabelText('Seleccionar Trapeado'))
    fireEvent.click(screen.getByRole('button', { name: 'Recursos en bloque' }))
    const modal = await screen.findByText(/Recursos en bloque · 2 actividades/)
    expect(modal).toBeTruthy()
    // insumos: solo los activos
    expect(screen.getByLabelText('Elegir Escoba')).toBeTruthy()
    expect(screen.queryByLabelText('Elegir Cloro')).toBeNull()
    fireEvent.click(screen.getByLabelText('Elegir Escoba'))
    fireEvent.change(screen.getByLabelText('Cantidad de Escoba'), { target: { value: '2.5' } })
    // equipo: sin los dados de baja; herramientas no aparecen en esa pestaña
    fireEvent.click(screen.getByRole('tab', { name: /Equipo/ }))
    expect(screen.queryByLabelText('Elegir Trapeador')).toBeNull()
    expect(screen.queryByLabelText('Elegir Aspiradora')).toBeNull()
    fireEvent.click(screen.getByLabelText('Elegir Hidrolavadora'))
    fireEvent.click(screen.getByLabelText('Hidrolavadora obligatoria'))
    fireEvent.click(screen.getByRole('button', { name: 'Agregar a 2 actividades' }))
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1))
    expect(m.confirm.mock.calls[0][0].text).toMatch(/Se vincularán 2 recursos a 2 actividades/)
    expect(m.rpc).toHaveBeenCalledWith('plantillas_recursos_en_bloque', {
      p_project_id: 'p1', p_plantilla_ids: ['pl1', 'pl2'], p_accion: 'agregar',
      p_suministros: [{ id: 's1', cantidad: 2.5 }], p_inventario: [{ id: 'i2', cantidad: 1, obligatoria: true }],
    })
    await waitFor(() => expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', text: '3 vínculos agregados en 2 actividades · 1 ya estaba (sin cambios)' })))
    // recarga los recursos de las tarjetas y limpia la selección
    expect(m.fetchRecursosPlantillas.mock.calls.length).toBeGreaterThanOrEqual(2)
    await waitFor(() => expect(screen.queryByRole('toolbar')).toBeNull())
  })

  it('quitar en bloque: sin cantidades, confirma en rojo y muestra los conteos de quitados', async () => {
    m.rpc.mockResolvedValueOnce({ data: resultado({ accion: 'quitar', plantillas: 1, recursos: 1, pares: 1, agregados: 0, ya_estaban: 0, quitados: 1, no_estaban: 0 }), error: null })
    abrir()
    fireEvent.click(screen.getByLabelText('Seleccionar Ronda'))
    fireEvent.click(screen.getByRole('button', { name: 'Recursos en bloque' }))
    await screen.findByText(/Recursos en bloque · 1 actividad/)
    fireEvent.click(screen.getByLabelText('Quitar de las actividades'))
    fireEvent.click(screen.getByRole('tab', { name: /Herramientas/ }))
    fireEvent.click(screen.getByLabelText('Elegir Trapeador'))
    expect(screen.queryByLabelText('Cantidad de Trapeador')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar de 1 actividad' }))
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('plantillas_recursos_en_bloque', expect.objectContaining({ p_accion: 'quitar', p_plantilla_ids: ['pl3'], p_inventario: [{ id: 'i1', cantidad: 1, obligatoria: false }] })))
    expect(m.confirm.mock.calls[0][0].variant).toBe('danger')
    await waitFor(() => expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', text: '1 vínculo quitado de 1 actividad' })))
  })

  it('un error del servidor se muestra sin prefijo y el modal sigue abierto; una cantidad inválida no llega al servidor', async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { message: 'PLANTILLAS_BLOQUE_PERMISO: para asignar insumos necesitas permiso para ver la pestaña Suministros.' } })
    abrir()
    fireEvent.click(screen.getByLabelText('Seleccionar Barrido'))
    fireEvent.click(screen.getByRole('button', { name: 'Recursos en bloque' }))
    await screen.findByText(/Recursos en bloque · 1 actividad/)
    fireEvent.click(screen.getByLabelText('Elegir Escoba'))
    fireEvent.change(screen.getByLabelText('Cantidad de Escoba'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar a 1 actividad' }))
    await waitFor(() => expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: expect.stringMatching(/«Escoba» debe ser mayor que cero/) })))
    expect(m.rpc).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Cantidad de Escoba'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar a 1 actividad' }))
    await waitFor(() => expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', title: 'No se aplicó nada', text: 'para asignar insumos necesitas permiso para ver la pestaña Suministros.' })))
    expect(within(screen.getByRole('dialog')).getByText(/Recursos en bloque · 1 actividad/)).toBeTruthy()
  })
})
