// Ruta del día de Limpieza (20261103000000): el tablero de «Tareas por turno»
// en modo ruta, sobre lo asignado en el calendario.
//
// Lo que se cubre: que entren sólo los turnos del día con alguna rutina; que de
// esos turnos se traigan TODAS sus tareas (cerrar el turno calcula el puntaje
// sobre lo que ve); que la persona se nombre con lo que trae el turno aunque no
// se lea el tab Personal; que en la ruta sólo se ejecute (sin alta ni borrado de
// turnos o tareas sueltas); que cambiar la fecha cargue ese día; y que la
// respuesta tardía del día que se dejó no reemplace a la del día elegido.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { TareaBloque, TurnoCalendarioLimpieza } from '../../../../../types'

type Err = { message: string } | null

const mocks = vi.hoisted(() => ({
  fetchCalendarioLimpieza: vi.fn(async (..._a: unknown[]) => ({ turnos: [] as TurnoCalendarioLimpieza[], error: null as Err })),
  fetchTareasDeTurnos: vi.fn(async (..._a: unknown[]) => ({ tareas: [] as TareaBloque[], error: null as Err })),
  fetchInsumosDeTareas: vi.fn(async (..._a: unknown[]) => ({ insumos: [], error: null as Err })),
  noUsado: vi.fn(async (..._a: unknown[]) => ({ data: null, error: null as Err })),
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
}))

vi.mock('../../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../../domain/condominios/tabQueries', () => ({
  fetchCalendarioLimpieza: mocks.fetchCalendarioLimpieza,
  fetchTareasDeTurnos: mocks.fetchTareasDeTurnos,
  fetchInsumosDeTareas: mocks.fetchInsumosDeTareas,
}))
vi.mock('../../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.noUsado,
  createCondominioRowReturning: mocks.noUsado,
  updateCondominioRow: mocks.noUsado,
  deleteCondominioRow: mocks.noUsado,
  cerrarTareaYConsumir: mocks.noUsado,
}))
vi.mock('../../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../../../shared/PromptDialog', () => ({ openPromptDialog: vi.fn() }))
vi.mock('../../../../shared/ImageUploader', () => ({ MultiImageUploader: () => null }))

const { VistaRutaDia } = await import('../VistaRutaDia')

const HOY = '2026-10-21'

function turno(over: Partial<TurnoCalendarioLimpieza> = {}): TurnoCalendarioLimpieza {
  return {
    bloque_id: 'b1', personal_id: 'p1', personal_nombre: 'Ana Pérez', personal_cargo: 'conserje',
    personal_estado: 'activo', fecha: HOY, turno: 'manana', estado: 'pendiente',
    iniciado_en: null, cerrado_en: null, plantilla_horario_id: 'h1', jornada_nombre: 'Mañana',
    jornada_codigo: 'MA', jornada_color: null, hora_inicio: '07:00:00', hora_fin: '15:00:00',
    horas_planificadas: 8, rutinas: [{ rutina_id: 'r1', tareas: 1, pendientes: 1, hechas: 0, trabajadas: 0 }],
    otras_tareas: 0, ...over,
  }
}

function montar(canEdit = true) {
  return render(
    <VistaRutaDia proyectoId="p1" companyId="co1" userId="u1" personal={[]} plantillas={[]} areas={[]} canEdit={canEdit} />,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 21, 10, 0, 0))
  Object.values(mocks).forEach(m => m.mockClear())
  mocks.fetchCalendarioLimpieza.mockResolvedValue({
    turnos: [
      turno(),
      // Turno de hoy SIN rutina: no es parte de la ruta.
      turno({ bloque_id: 'b2', personal_id: 'p2', personal_nombre: 'Luis Gómez', rutinas: [] }),
    ],
    error: null,
  })
  mocks.fetchTareasDeTurnos.mockResolvedValue({
    tareas: [
      { id: 't1', bloque_id: 'b1', titulo: 'Barrido de piso', orden: 0, estado: 'pendiente', rutina_id: 'r1', foto_urls: [], requiere_foto: false, created_at: '' },
      { id: 't2', bloque_id: 'b1', titulo: 'Tarea suelta', orden: 1, estado: 'pendiente', rutina_id: null, foto_urls: [], requiere_foto: false, created_at: '' },
    ] as TareaBloque[],
    error: null,
  })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('VistaRutaDia', () => {
  it('trae los turnos de HOY con rutina y TODAS sus tareas, y nombra a la persona por el turno', async () => {
    montar()
    await waitFor(() => expect(mocks.fetchTareasDeTurnos).toHaveBeenCalledWith(['b1']))
    expect(mocks.fetchCalendarioLimpieza).toHaveBeenCalledWith('p1', HOY, HOY)
    expect(await screen.findByText(/Ana Pérez/)).toBeTruthy()
    expect(screen.queryByText(/Luis Gómez/)).toBeNull()
    expect(screen.getByRole('heading', { name: 'Ruta del día' })).toBeTruthy()
  })

  it('en la ruta sólo se ejecuta: sin alta de turnos, sin borrar el turno ni cargar tareas sueltas', async () => {
    montar()
    await screen.findByText(/Ana Pérez/)
    expect(screen.queryByText('+ Asignar turno')).toBeNull()
    expect(screen.queryByText('🗑')).toBeNull()
    // Iniciar el turno sí: es como se empieza a ejecutar.
    expect(screen.getByText('▶ Iniciar')).toBeTruthy()
    fireEvent.click(screen.getByText(/Ana Pérez/))
    expect(await screen.findByText(/Barrido de piso/)).toBeTruthy()
    expect(screen.queryByText('+ Agregar tarea')).toBeNull()
    expect(screen.queryByText(/Cargar tareas de/)).toBeNull()
  })

  it('cambiar la fecha carga ese día', async () => {
    const { container } = montar()
    await screen.findByText(/Ana Pérez/)
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '2026-10-22' } })
    await waitFor(() => expect(mocks.fetchCalendarioLimpieza).toHaveBeenCalledWith('p1', '2026-10-22', '2026-10-22'))
  })

  it('una respuesta que llega tarde (de un día ya dejado) no pisa la del día vigente', async () => {
    let tardia!: (v: { turnos: TurnoCalendarioLimpieza[]; error: null }) => void
    mocks.fetchCalendarioLimpieza
      .mockImplementationOnce(() => new Promise(res => { tardia = res }) as never)
      .mockResolvedValueOnce({ turnos: [turno({ fecha: '2026-10-22', personal_nombre: 'Marta Ruiz' })], error: null })
    const { container } = montar()
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '2026-10-22' } })
    expect(await screen.findByText(/Marta Ruiz/)).toBeTruthy()

    // Llega por fin la de hoy: se ignora, sin pedir siquiera sus tareas.
    tardia({ turnos: [turno()], error: null })
    await new Promise(r => setTimeout(r, 0))
    expect(mocks.fetchTareasDeTurnos).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Ana Pérez/)).toBeNull()
    expect(screen.getByText(/Marta Ruiz/)).toBeTruthy()
  })

  it('tampoco si lo que llega tarde son las tareas del día dejado', async () => {
    let tardias!: (v: { tareas: TareaBloque[]; error: null }) => void
    mocks.fetchCalendarioLimpieza
      .mockResolvedValueOnce({ turnos: [turno()], error: null })
      .mockResolvedValueOnce({ turnos: [turno({ bloque_id: 'b9', fecha: '2026-10-22', personal_nombre: 'Marta Ruiz' })], error: null })
    mocks.fetchTareasDeTurnos
      .mockImplementationOnce(() => new Promise(res => { tardias = res }) as never)
      .mockResolvedValueOnce({ tareas: [], error: null })
    const { container } = montar()
    await waitFor(() => expect(mocks.fetchTareasDeTurnos).toHaveBeenCalledWith(['b1']))
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '2026-10-22' } })
    expect(await screen.findByText(/Marta Ruiz/)).toBeTruthy()

    tardias({ tareas: [], error: null })
    await new Promise(r => setTimeout(r, 0))
    expect(screen.getByText(/Marta Ruiz/)).toBeTruthy()
  })
})
