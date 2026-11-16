// Rutinas de limpieza — el buscador acota las tarjetas por nombre, descripción,
// jornada o las áreas del recorrido, sin distinguir acentos. Las demás vistas de
// Limpieza ya tenían lo suyo: el Calendario busca empleados, la Ruta del día es
// el tablero de turnos y las Novedades tienen su propio buscador.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { AreaCondominio, PlantillaTareaCargo } from '../../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRowReturning: vi.fn(async () => ({ data: null, error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  guardarRecorridoRutina: vi.fn(async () => ({ data: null, error: null })),
  fetchRutinasLimpieza: vi.fn(async () => ({ rutinas: [] as unknown[], pasos: [] as unknown[], paradas: [] as unknown[], horarios: [] as unknown[], error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))
vi.mock('../../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../../domain/condominios/tabMutations', () => ({
  createCondominioRowReturning: mocks.createCondominioRowReturning,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
  guardarRecorridoRutina: mocks.guardarRecorridoRutina,
}))
vi.mock('../../../../../domain/condominios/tabQueries', () => ({ fetchRutinasLimpieza: mocks.fetchRutinasLimpieza }))
vi.mock('../../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

const { VistaRutinas } = await import('../VistaRutinas')

const area = (id: string, nombre: string): AreaCondominio => ({
  id, company_id: 'co1', project_id: 'p1', nombre, descripcion: null, icono: '🚪', orden: 0, activo: true, created_at: '2026-01-01T00:00:00.000Z',
})
const AREAS = [area('a1', 'Apartamento 1AB'), area('a2', 'Gradas'), area('a3', 'Piscina')]
const BARRER = { id: 'barrer', company_id: 'co1', project_id: 'p1', cargo: 'conserje', titulo: 'Barrido de piso', descripcion: null, icono: '🧹', orden: 0, area_id: null, requiere_foto: false, activo: true, servicio: 'limpieza', duracion_estimada_min: 5, created_at: '' } as unknown as PlantillaTareaCargo

const rutina = (id: string, nombre: string, over: Record<string, unknown> = {}) => ({
  id, company_id: 'co1', project_id: 'p1', nombre, descripcion: null, area_id: null, servicio: 'limpieza',
  plantilla_horario_id: null, activa: true, orden: 0, created_at: '2026-01-01T00:00:00.000Z', ...over,
})
const parada = (id: string, rutina_id: string, area_id: string, orden: number) => ({
  id, company_id: 'co1', project_id: 'p1', rutina_id, area_id, orden, created_at: '2026-01-01T00:00:00.000Z',
})

const DATOS = {
  rutinas: [
    rutina('r1', 'Rutina Lunes AM', { descripcion: 'Tareas primera hora' }),
    rutina('r2', 'Ronda de cierre', { horario_nombre: 'Nocturna' }),
  ],
  paradas: [parada('p1', 'r1', 'a1', 0), parada('p2', 'r1', 'a2', 1), parada('p3', 'r2', 'a3', 0)],
  pasos: [], horarios: [], error: null,
}

function montar(datos: typeof DATOS = DATOS) {
  mocks.fetchRutinasLimpieza.mockResolvedValue(datos as never)
  return render(<VistaRutinas plantillas={[BARRER]} areas={AREAS} proyectoId="p1" companyId="co1" canCreate canEdit canDelete onRefresh={() => {}} />)
}
const visibles = () => ['Rutina Lunes AM', 'Ronda de cierre'].filter(n => screen.queryByText(n))

beforeEach(() => { vi.clearAllMocks() })
afterEach(cleanup)

describe('Rutinas de limpieza · buscador', () => {
  it('acota por nombre, descripción, jornada o área del recorrido, sin distinguir acentos', async () => {
    montar()
    await screen.findByText('Rutina Lunes AM')
    const buscador = screen.getByRole('searchbox', { name: 'Buscar rutina' })
    expect(visibles()).toEqual(['Rutina Lunes AM', 'Ronda de cierre'])

    fireEvent.change(buscador, { target: { value: 'CIERRE' } })
    expect(visibles()).toEqual(['Ronda de cierre'])
    fireEvent.change(buscador, { target: { value: 'primera hora' } })
    expect(visibles()).toEqual(['Rutina Lunes AM'])
    fireEvent.change(buscador, { target: { value: 'nocturna' } })
    expect(visibles()).toEqual(['Ronda de cierre'])
    // ¿Qué rutina pasa por las gradas? Por el área del recorrido.
    fireEvent.change(buscador, { target: { value: 'gradas' } })
    expect(visibles()).toEqual(['Rutina Lunes AM'])
    fireEvent.change(buscador, { target: { value: 'piscina' } })
    expect(visibles()).toEqual(['Ronda de cierre'])

    fireEvent.change(buscador, { target: { value: 'zzz' } })
    expect(visibles()).toEqual([])
    expect(screen.getByText('Ninguna rutina coincide con «zzz»')).toBeTruthy()
    // El botón de alta sigue a la vista aunque nada coincida.
    expect(screen.getByText('+ Nueva rutina')).toBeTruthy()
    fireEvent.change(buscador, { target: { value: '' } })
    expect(visibles()).toEqual(['Rutina Lunes AM', 'Ronda de cierre'])
  })

  it('sin rutinas no hay buscador y queda el estado vacío de siempre', async () => {
    montar({ ...DATOS, rutinas: [], paradas: [] })
    expect(await screen.findByText('Todavía no hay rutinas')).toBeTruthy()
    expect(screen.queryByRole('searchbox', { name: 'Buscar rutina' })).toBeNull()
  })
})
