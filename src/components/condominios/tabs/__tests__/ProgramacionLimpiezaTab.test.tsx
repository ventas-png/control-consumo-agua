// El tab Limpieza tras el calendario (20261103000000): cuatro vistas —Calendario,
// Rutinas, Ruta del día, Novedades— y los indicadores de arriba calculados
// sobre las TAREAS de las rutinas asignadas, no sobre las programaciones por
// área del motor anterior.
//
// Lo que se cubre aquí es el contenedor: qué vistas ofrece (y cuáles ya no),
// que los indicadores y las novedades salgan de la lectura del calendario, que
// la persona se nombre aunque quien mira no lea el tab Personal, y que atender
// una novedad la marque y recargue. Cada vista tiene su propio archivo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type {
  AreaCondominio, PlantillaTareaCargo, TareaBloque, TurnoCalendarioLimpieza,
} from '../../../../types'

type Err = { message: string; code?: string } | null

const mocks = vi.hoisted(() => ({
  fetchCalendarioLimpieza: vi.fn(async (..._a: unknown[]) => ({
    turnos: [] as TurnoCalendarioLimpieza[], error: null as Err,
  })),
  fetchNovedadesRutinas: vi.fn(async (..._a: unknown[]) => ({ tareas: [] as TareaBloque[], error: null as Err })),
  fetchRutinasLimpieza: vi.fn(async (..._a: unknown[]) => ({
    rutinas: [] as Array<Record<string, unknown>>, pasos: [], paradas: [], horarios: [], error: null as Err,
  })),
  fetchTareasDeTurnos: vi.fn(async (..._a: unknown[]) => ({ tareas: [] as TareaBloque[], error: null as Err })),
  fetchInsumosDeTareas: vi.fn(async (..._a: unknown[]) => ({ insumos: [], error: null as Err })),
  atenderNovedad: vi.fn(async (..._a: unknown[]) => ({ error: null as Err })),
  asignarRutinasTurno: vi.fn(async (..._a: unknown[]) => ({ data: null, error: null as Err })),
  quitarRutinaTurno: vi.fn(async (..._a: unknown[]) => ({ data: 0, error: null as Err })),
  noUsado: vi.fn(async (..._a: unknown[]) => ({ data: null, error: null as Err })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
  onRefresh: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabQueries', () => ({
  fetchCalendarioLimpieza: mocks.fetchCalendarioLimpieza,
  fetchNovedadesRutinas: mocks.fetchNovedadesRutinas,
  fetchRutinasLimpieza: mocks.fetchRutinasLimpieza,
  fetchTareasDeTurnos: mocks.fetchTareasDeTurnos,
  fetchInsumosDeTareas: mocks.fetchInsumosDeTareas,
}))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  atenderNovedad: mocks.atenderNovedad,
  asignarRutinasTurno: mocks.asignarRutinasTurno,
  quitarRutinaTurno: mocks.quitarRutinaTurno,
  createCondominioRow: mocks.noUsado,
  createCondominioRowReturning: mocks.noUsado,
  updateCondominioRow: mocks.noUsado,
  deleteCondominioRow: mocks.noUsado,
  cerrarTareaYConsumir: mocks.noUsado,
  guardarRecorridoRutina: mocks.noUsado,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: vi.fn() }))
vi.mock('../../../shared/ImageUploader', () => ({ MultiImageUploader: () => null }))
vi.mock('../../../shared/ImageGallery', () => ({ ImageGallery: () => null }))

const { ProgramacionLimpiezaTab } = await import('../ProgramacionLimpiezaTab')

const HOY = '2026-10-21'

function turno(over: Partial<TurnoCalendarioLimpieza> = {}): TurnoCalendarioLimpieza {
  return {
    bloque_id: 'b1', personal_id: 'p1', personal_nombre: 'Ana Pérez', personal_cargo: 'conserje',
    personal_estado: 'activo', fecha: HOY, turno: 'manana', estado: 'pendiente',
    iniciado_en: null, cerrado_en: null, plantilla_horario_id: 'h1', jornada_nombre: 'Mañana',
    jornada_codigo: 'MA', jornada_color: null, hora_inicio: '07:00:00', hora_fin: '15:00:00',
    horas_planificadas: 8, rutinas: [], otras_tareas: 0, ...over,
  }
}
const enTurno = (rutina_id: string, tareas: number, pendientes: number, hechas: number) =>
  ({ rutina_id, tareas, pendientes, hechas, trabajadas: hechas })

function tarea(over: Partial<TareaBloque> = {}): TareaBloque {
  return {
    id: 't1', bloque_id: 'b1', titulo: 'Barrido de piso', orden: 0, requiere_foto: false,
    estado: 'con_observacion', foto_urls: [], created_at: '2026-10-20T10:00:00.000Z',
    rutina_id: 'r1', novedad: 'Gotea la llave del lavamanos', prioridad: 'alta',
    requiere_mantenimiento: true, ...over,
  } as TareaBloque
}

const area: AreaCondominio = {
  id: 'a1', company_id: 'co1', project_id: 'p1', nombre: 'Lobby', descripcion: null,
  icono: '🏢', orden: 0, activo: true, created_at: '2026-01-01T00:00:00.000Z',
}

function montar(props: Partial<Parameters<typeof ProgramacionLimpiezaTab>[0]> = {}) {
  return render(
    <ProgramacionLimpiezaTab
      personal={[]}
      areas={[area]}
      plantillas={[] as PlantillaTareaCargo[]}
      proyectoId="p1"
      companyId="co1"
      userId="u1"
      canCreate
      canEdit
      canDelete
      onRefresh={mocks.onRefresh}
      {...props}
    />,
  )
}

const indicador = (etiqueta: RegExp) =>
  within(screen.getByLabelText('Indicadores de limpieza')).getByText(etiqueta).parentElement!

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 21, 10, 0, 0))
  Object.values(mocks).forEach(m => m.mockClear())
  mocks.fetchCalendarioLimpieza.mockResolvedValue({ turnos: [], error: null })
  mocks.fetchNovedadesRutinas.mockResolvedValue({ tareas: [], error: null })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('ProgramacionLimpiezaTab · las vistas', () => {
  it('ofrece Calendario, Rutinas, Ruta del día y Novedades; el calendario es la de entrada', () => {
    montar()
    const pestañas = screen.getAllByRole('tab').map(t => t.textContent?.replace(/^\S+\s/, ''))
    expect(pestañas).toEqual(['Calendario', 'Rutinas', 'Ruta del día', 'Novedades'])
    expect(screen.getByRole('tab', { name: /Calendario/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('ya no ofrece «Áreas», «Áreas del catálogo» ni «Actividades» (se administran en sus tabs)', () => {
    montar()
    for (const vieja of [/^🧹 Áreas$/, /Áreas del catálogo/, /Actividades/]) {
      expect(screen.queryByRole('tab', { name: vieja })).toBeNull()
    }
  })

  it('«Rutinas» ya no ofrece «Generar tareas»: se asigna desde el calendario', async () => {
    montar()
    fireEvent.click(screen.getByRole('tab', { name: /Rutinas/ }))
    await waitFor(() => expect(mocks.fetchRutinasLimpieza).toHaveBeenCalled())
    expect(screen.queryByText(/Generar tareas/)).toBeNull()
    expect(screen.getByText(/se asigna en el Calendario/)).toBeTruthy()
  })
})

describe('ProgramacionLimpiezaTab · indicadores sobre las tareas de las rutinas', () => {
  it('lee los últimos 30 días una sola vez para indicadores y novedades', async () => {
    montar()
    await waitFor(() => expect(mocks.fetchCalendarioLimpieza).toHaveBeenCalledWith('p1', '2026-09-21', HOY))
    expect(mocks.fetchNovedadesRutinas).toHaveBeenCalledWith('p1', '2026-09-21')
  })

  it('atrasadas de la semana, pendientes y hechas de hoy, turnos de hoy sin rutina y lo que pide mantenimiento', async () => {
    mocks.fetchCalendarioLimpieza.mockResolvedValue({
      turnos: [
        // Hace 3 días: 2 pendientes (cuentan como atrasadas).
        turno({ bloque_id: 'bA', fecha: '2026-10-18', rutinas: [enTurno('r1', 4, 2, 2)] }),
        // Hace 10 días: fuera de la semana, no cuenta.
        turno({ bloque_id: 'bV', fecha: '2026-10-11', rutinas: [enTurno('r1', 4, 4, 0)] }),
        // Hoy: 5 tareas, 3 pendientes, 2 hechas.
        turno({ bloque_id: 'bH', rutinas: [enTurno('r1', 4, 2, 2), enTurno('r2', 1, 1, 0)] }),
        // Hoy, sin rutina: Luis, que sí hace rutinas (tuvo una el 17).
        turno({ bloque_id: 'bS', personal_id: 'p2', personal_nombre: 'Luis Gómez' }),
        turno({ bloque_id: 'bS0', personal_id: 'p2', personal_nombre: 'Luis Gómez', fecha: '2026-10-17', rutinas: [enTurno('r1', 1, 0, 1)] }),
        // Hoy, sin rutina, de alguien que nunca hace rutinas (seguridad): no cuenta.
        turno({ bloque_id: 'bG', personal_id: 'p9', personal_nombre: 'Guardia' }),
        // Hoy, sin rutina pero dado de baja: no cuenta.
        turno({ bloque_id: 'bI', personal_id: 'p3', personal_nombre: 'Baja', personal_estado: 'inactivo' }),
      ],
      error: null,
    })
    mocks.fetchNovedadesRutinas.mockResolvedValue({
      tareas: [tarea({ bloque_id: 'bA' }), tarea({ id: 't2', bloque_id: 'bH', requiere_mantenimiento: false, novedad: 'Falta jabón' })],
      error: null,
    })
    montar()

    await waitFor(() => expect(indicador(/Atrasadas/).textContent).toMatch(/^🔴2/))
    expect(indicador(/Pendientes hoy \(de 5\)/).textContent).toMatch(/3/)
    expect(indicador(/Hechas hoy/).textContent).toMatch(/2/)
    expect(indicador(/Turnos de hoy sin rutina/).textContent).toMatch(/1/)
    expect(indicador(/Requieren manto/).textContent).toMatch(/1/)
    expect(screen.getByRole('tab', { name: /Novedades \(1\)/ })).toBeTruthy()
  })
})

describe('ProgramacionLimpiezaTab · novedades de las rutinas', () => {
  it('nombra a la persona con lo que trae el turno, aunque no se lea el tab Personal', async () => {
    mocks.fetchCalendarioLimpieza.mockResolvedValue({
      turnos: [turno({ bloque_id: 'bA', fecha: '2026-10-18', rutinas: [enTurno('r1', 1, 0, 1)] })],
      error: null,
    })
    mocks.fetchNovedadesRutinas.mockResolvedValue({ tareas: [tarea({ bloque_id: 'bA' })], error: null })
    montar({ personal: [] })

    fireEvent.click(screen.getByRole('tab', { name: /Novedades/ }))
    expect(await screen.findByText(/Gotea la llave del lavamanos/)).toBeTruthy()
    expect(screen.getAllByText(/Ana Pérez/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Empleado dado de baja/)).toBeNull()
  })

  it('atender la marca y recarga indicadores y panel', async () => {
    mocks.fetchCalendarioLimpieza.mockResolvedValue({
      turnos: [turno({ bloque_id: 'bA', fecha: '2026-10-18', rutinas: [enTurno('r1', 1, 0, 1)] })],
      error: null,
    })
    mocks.fetchNovedadesRutinas.mockResolvedValue({ tareas: [tarea({ bloque_id: 'bA' })], error: null })
    montar()

    fireEvent.click(screen.getByRole('tab', { name: /Novedades/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Atender|atendida/i }))
    await waitFor(() => expect(mocks.atenderNovedad).toHaveBeenCalled())
    const [novedad] = mocks.atenderNovedad.mock.calls[0] as unknown as [{ fuente: string; id: string }]
    expect(novedad).toMatchObject({ fuente: 'tarea', id: 't1' })
    await waitFor(() => expect(mocks.onRefresh).toHaveBeenCalled())
    expect(mocks.fetchCalendarioLimpieza.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
