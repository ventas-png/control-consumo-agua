// Catálogo de actividades — el formulario (nueva y editar) abre en ventana emergente y
// el buscador acota las tarjetas por título o descripción sin distinguir acentos ni
// mayúsculas, combinado con los filtros y con «Seleccionar todas».
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { PlantillaTareaCargo } from '../../../types'

const m = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  fetchRecursosPlantillas: vi.fn(async () => ({ suministros: [], herramientas: [], error: null })),
  openPromptDialog: vi.fn(async () => null),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))
vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) }, warmUpSupabase: vi.fn() }))
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
  plantilla('pl1', 'Barrido de Piso en Pasillo'),
  plantilla('pl2', 'Limpieza de baño', { descripcion: 'Lavar sanitarios y espejos' }),
  plantilla('pl3', 'Ronda nocturna', { cargo: 'guardia', servicio: 'seguridad', icono: '🔐' }),
]

function abrir(over: Partial<Parameters<typeof ActividadesCatalog>[0]> = {}) {
  const onRefresh = vi.fn()
  render(<ActividadesCatalog plantillas={plantillas} areas={[]} suministros={[]} equipos={[]}
    proyectoId="p1" companyId="co1" canCreate canEdit canDelete onRefresh={onRefresh} {...over} />)
  return { onRefresh }
}
const buscador = () => screen.getByRole('searchbox', { name: 'Buscar actividad' })
const titulosVisibles = () => plantillas.filter(p => screen.queryByTestId(`actividad-${p.id}`)).map(p => p.titulo)

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Catálogo de actividades · buscador', () => {
  it('acota las tarjetas por título sin distinguir mayúsculas ni acentos', () => {
    abrir()
    expect(titulosVisibles()).toHaveLength(3)
    fireEvent.change(buscador(), { target: { value: 'BANO' } })
    expect(titulosVisibles()).toEqual(['Limpieza de baño'])
    fireEvent.change(buscador(), { target: { value: 'pasíllo' } })
    expect(titulosVisibles()).toEqual(['Barrido de Piso en Pasillo'])
    fireEvent.change(buscador(), { target: { value: '' } })
    expect(titulosVisibles()).toHaveLength(3)
  })

  it('también busca en la descripción y se combina con el filtro de cargo', () => {
    abrir()
    fireEvent.change(buscador(), { target: { value: 'espejos' } })
    expect(titulosVisibles()).toEqual(['Limpieza de baño'])
    fireEvent.change(buscador(), { target: { value: 'ronda' } })
    expect(titulosVisibles()).toEqual(['Ronda nocturna'])
    // La ronda es de guardia: con el chip de conserje no queda ninguna.
    fireEvent.click(screen.getByText('Conserje (2)'))
    expect(titulosVisibles()).toEqual([])
    expect(screen.getByText('Nada con esos filtros')).toBeTruthy()
    expect(screen.getByText(/coincide con «ronda»/)).toBeTruthy()
  })

  it('«Seleccionar todas» sólo toma las tarjetas que deja ver el buscador', () => {
    abrir()
    fireEvent.change(buscador(), { target: { value: 'limpieza' } })
    fireEvent.click(screen.getByLabelText('Seleccionar todas las actividades visibles'))
    expect(screen.getByRole('toolbar', { name: '1 actividad seleccionado' })).toBeTruthy()
  })
})

describe('Catálogo de actividades · formulario en ventana emergente', () => {
  it('+ Nueva actividad abre un diálogo con el formulario en blanco y Cancelar lo cierra sin guardar', () => {
    abrir()
    fireEvent.click(screen.getByText('+ Nueva actividad'))
    const ventana = screen.getByRole('dialog', { name: 'Nueva actividad' })
    expect((within(ventana).getByLabelText('Título de la actividad *') as HTMLInputElement).value).toBe('')
    // El catálogo sigue detrás de la ventana.
    expect(screen.getByTestId('actividad-pl1')).toBeTruthy()
    fireEvent.change(within(ventana).getByLabelText('Título de la actividad *'), { target: { value: 'Borrador' } })
    fireEvent.click(within(ventana).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(m.createCondominioRow).not.toHaveBeenCalled()

    // Al reabrir, el borrador se descartó.
    fireEvent.click(screen.getByText('+ Nueva actividad'))
    expect((screen.getByLabelText('Título de la actividad *') as HTMLInputElement).value).toBe('')
  })

  it('Editar abre el diálogo con los datos de la actividad y Escape lo cierra sin guardar', () => {
    abrir()
    const tarjeta = screen.getByTestId('actividad-pl2')
    fireEvent.click(within(tarjeta).getByRole('button', { name: '✏️ Editar' }))
    const ventana = screen.getByRole('dialog', { name: 'Editar actividad' })
    expect((within(ventana).getByLabelText('Título de la actividad *') as HTMLInputElement).value).toBe('Limpieza de baño')
    expect((within(ventana).getByLabelText('Descripción / instrucciones') as HTMLTextAreaElement).value).toBe('Lavar sanitarios y espejos')
    expect(within(ventana).getByRole('button', { name: 'Actualizar' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(m.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('Actualizar guarda los cambios, cierra la ventana y refresca', async () => {
    const { onRefresh } = abrir()
    fireEvent.click(within(screen.getByTestId('actividad-pl1')).getByRole('button', { name: '✏️ Editar' }))
    const ventana = screen.getByRole('dialog', { name: 'Editar actividad' })
    fireEvent.change(within(ventana).getByLabelText('Título de la actividad *'), { target: { value: 'Barrido de pasillos' } })
    fireEvent.click(within(ventana).getByRole('button', { name: 'Actualizar' }))
    await waitFor(() => expect(m.updateCondominioRow).toHaveBeenCalledWith('plantillas_tarea_cargo', 'pl1', expect.objectContaining({ titulo: 'Barrido de pasillos' })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('en consulta y en modo selector no hay botón de nueva actividad pero el buscador sigue', () => {
    abrir({ soloLectura: true })
    expect(screen.queryByText('+ Nueva actividad')).toBeNull()
    expect(buscador()).toBeTruthy()
    cleanup()
    abrir({ seleccion: { yaElegidas: new Set(), onElegir: vi.fn() } })
    expect(screen.queryByText('+ Nueva actividad')).toBeNull()
    fireEvent.change(buscador(), { target: { value: 'ronda' } })
    expect(titulosVisibles()).toEqual(['Ronda nocturna'])
  })
})
