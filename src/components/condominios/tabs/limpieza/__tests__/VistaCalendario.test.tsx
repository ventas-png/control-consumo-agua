// Calendario de limpieza (20261103000000) desde la UI.
//
// Lo que se cubre es lo que la suite SQL no ve, porque es de la vista: que
// soltar una rutina sobre un día llame a la RPC con ESE turno; que ＋ asigne
// varias en el orden marcado; que mover sea asignar en el destino ANTES de
// quitar del origen; que sólo se ofrezca quitar lo que la base dejaría quitar;
// y que un día pasado o un turno cerrado no reciban nada. La base vuelve a
// exigir todo eso (supabase/tests/limpieza_calendario).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { PlantillaTareaCargo, TurnoCalendarioLimpieza } from '../../../../../types'

type Err = { message: string; code?: string } | null

const mocks = vi.hoisted(() => ({
  fetchCalendarioLimpieza: vi.fn(async (..._a: unknown[]) => ({
    turnos: [] as TurnoCalendarioLimpieza[], error: null as Err,
  })),
  fetchRutinasLimpieza: vi.fn(async (..._a: unknown[]) => ({
    rutinas: [] as Array<Record<string, unknown>>,
    pasos: [] as Array<Record<string, unknown>>,
    paradas: [] as Array<Record<string, unknown>>,
    horarios: [], error: null as Err,
  })),
  asignarRutinasTurno: vi.fn(async (..._a: unknown[]) => ({
    data: { generadas: 3, omitidas_existente: 0 } as { generadas: number; omitidas_existente: number } | null,
    error: null as Err,
  })),
  quitarRutinaTurno: vi.fn(async (..._a: unknown[]) => ({ data: 3 as number | null, error: null as Err })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
  onCambio: vi.fn(),
}))

vi.mock('../../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../../domain/condominios/tabQueries', () => ({
  fetchCalendarioLimpieza: mocks.fetchCalendarioLimpieza,
  fetchRutinasLimpieza: mocks.fetchRutinasLimpieza,
}))
vi.mock('../../../../../domain/condominios/tabMutations', () => ({
  asignarRutinasTurno: mocks.asignarRutinasTurno,
  quitarRutinaTurno: mocks.quitarRutinaTurno,
}))
vi.mock('../../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

const { VistaCalendario } = await import('../VistaCalendario')

function turno(over: Partial<TurnoCalendarioLimpieza> = {}): TurnoCalendarioLimpieza {
  return {
    bloque_id: 'b22', personal_id: 'p1', personal_nombre: 'Ana Pérez', personal_cargo: 'conserje',
    personal_estado: 'activo', fecha: '2026-10-22', turno: 'manana', estado: 'pendiente',
    iniciado_en: null, cerrado_en: null, plantilla_horario_id: 'h1', jornada_nombre: 'Mañana',
    jornada_codigo: 'MA', jornada_color: null, hora_inicio: '07:00:00', hora_fin: '15:00:00',
    horas_planificadas: 8, rutinas: [], otras_tareas: 0, ...over,
  }
}
const enTurno = (rutina_id: string, trabajadas = 0) => ({ rutina_id, tareas: 3, pendientes: 3 - trabajadas, hechas: trabajadas, trabajadas })

const RUTINAS = [
  { id: 'rN', nombre: 'Niveles', activa: true, orden: 0 },
  { id: 'rS', nombre: 'Sótanos', activa: true, orden: 1 },
  { id: 'rX', nombre: 'Vieja', activa: false, orden: 2 },
]
const PASOS = [
  { id: 's1', rutina_id: 'rN', rutina_area_id: null, plantilla_tarea_id: 'barrer', orden: 0, obligatoria: true, created_at: '' },
  { id: 's2', rutina_id: 'rS', rutina_area_id: null, plantilla_tarea_id: 'barrer', orden: 0, obligatoria: true, created_at: '' },
]
const PLANTILLAS = [{ id: 'barrer', titulo: 'Barrer', duracion_estimada_min: 300 }] as PlantillaTareaCargo[]

function cargar(turnos: TurnoCalendarioLimpieza[]) {
  mocks.fetchCalendarioLimpieza.mockResolvedValue({ turnos, error: null })
}

function montar(props: Partial<Parameters<typeof VistaCalendario>[0]> = {}) {
  return render(
    <VistaCalendario proyectoId="p1" companyId="co1" plantillas={PLANTILLAS} canEdit onCambio={mocks.onCambio} {...props} />,
  )
}

/** Arrastra `origen` y lo suelta sobre `destino` (eventos nativos de HTML5). */
function arrastrar(origen: Element, destino: Element) {
  const dataTransfer = { setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' }
  fireEvent.dragStart(origen, { dataTransfer })
  fireEvent.dragOver(destino, { dataTransfer })
  fireEvent.drop(destino, { dataTransfer })
  fireEvent.dragEnd(origen, { dataTransfer })
}

const paleta = () => screen.getByRole('list', { name: 'Rutinas para asignar' })
const deLaPaleta = (nombre: string) => within(paleta()).getByText(new RegExp(nombre)).closest('[draggable="true"]')!
const turnoDe = (nombre: RegExp) => screen.getByRole('group', { name: nombre })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 21, 10, 0, 0))   // miércoles 21 de octubre de 2026
  Object.values(mocks).forEach(m => m.mockClear())
  mocks.fetchRutinasLimpieza.mockResolvedValue({ rutinas: RUTINAS, pasos: PASOS, paradas: [], horarios: [], error: null })
  mocks.asignarRutinasTurno.mockResolvedValue({ data: { generadas: 3, omitidas_existente: 0 }, error: null })
  mocks.quitarRutinaTurno.mockResolvedValue({ data: 3, error: null })
  mocks.confirm.mockResolvedValue({ isConfirmed: true })
  cargar([])
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('VistaCalendario · el mes de cada empleado', () => {
  it('pide el mes en curso y muestra a cada persona activa con sus turnos (sin bajas)', async () => {
    cargar([
      turno(),
      turno({ bloque_id: 'b23', fecha: '2026-10-23', rutinas: [enTurno('rN')] }),
      turno({ bloque_id: 'bL', personal_id: 'p2', personal_nombre: 'Luis Gómez' }),
      turno({ bloque_id: 'bB', personal_id: 'p3', personal_nombre: 'Dado de baja', personal_estado: 'inactivo' }),
    ])
    montar()

    expect(await screen.findByRole('region', { name: 'Calendario de Ana Pérez' })).toBeTruthy()
    expect(mocks.fetchCalendarioLimpieza).toHaveBeenCalledWith('p1', '2026-10-01', '2026-10-31')
    expect(screen.getByRole('region', { name: 'Calendario de Luis Gómez' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: /Dado de baja/ })).toBeNull()
    // El día con turno muestra su jornada; la rutina asignada, su nombre.
    expect(within(turnoDe(/Ana Pérez el jue 22 oct/)).getByText('MA')).toBeTruthy()
    expect(within(turnoDe(/Ana Pérez el vie 23 oct/)).getByRole('button', { name: /^Niveles, Ana Pérez/ })).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Calendario de Ana Pérez' })).getByText('1 de 2 turnos con rutina')).toBeTruthy()
    // Sólo las rutinas activas se ofrecen.
    expect(within(paleta()).queryByText(/Vieja/)).toBeNull()
  })

  it('cambiar de mes pide ese mes; la búsqueda filtra por nombre', async () => {
    cargar([turno(), turno({ bloque_id: 'bL', personal_id: 'p2', personal_nombre: 'Luis Gómez' })])
    montar()
    await screen.findByRole('region', { name: 'Calendario de Ana Pérez' })

    fireEvent.change(screen.getByLabelText('Buscar empleado'), { target: { value: 'luis' } })
    expect(screen.queryByRole('region', { name: 'Calendario de Ana Pérez' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Calendario de Luis Gómez' })).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Mes siguiente'))
    await waitFor(() => expect(mocks.fetchCalendarioLimpieza).toHaveBeenCalledWith('p1', '2026-11-01', '2026-11-30'))
  })

  it('sin turnos en el mes, dice dónde se generan', async () => {
    montar()
    expect(await screen.findByText(/Los turnos de cada empleado se generan en/)).toBeTruthy()
    expect(screen.getByText('Asignación turnos')).toBeTruthy()
  })
})

describe('VistaCalendario · asignar', () => {
  it('soltar una rutina de la paleta sobre un día la asigna a ESE turno, y recarga', async () => {
    cargar([turno()])
    montar()
    await screen.findByRole('region', { name: 'Calendario de Ana Pérez' })
    await waitFor(() => expect(within(paleta()).getByText(/Niveles/)).toBeTruthy())

    arrastrar(deLaPaleta('Niveles'), turnoDe(/Ana Pérez el jue 22 oct/))

    await waitFor(() => expect(mocks.asignarRutinasTurno).toHaveBeenCalledWith('b22', ['rN']))
    expect(await screen.findByText('3 tareas asignadas a Ana Pérez el jue 22 oct.')).toBeTruthy()
    expect(mocks.fetchCalendarioLimpieza.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(mocks.onCambio).toHaveBeenCalled()
  })

  it('＋ abre la lista: se marcan varias y entran en el orden marcado; las ya asignadas se ven apagadas', async () => {
    cargar([turno({ rutinas: [] })])
    montar()
    await screen.findByRole('region', { name: 'Calendario de Ana Pérez' })
    await waitFor(() => expect(within(paleta()).getByText(/Sótanos/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Agregar rutinas a Ana Pérez el jue 22 oct' }))
    const v = screen.getByRole('dialog', { name: 'Rutinas para Ana Pérez' })
    fireEvent.click(within(v).getByRole('checkbox', { name: /Sótanos/ }))
    fireEvent.click(within(v).getByRole('checkbox', { name: /Niveles/ }))
    // 5 h + 5 h contra un turno de 8 h: el pie lo advierte antes de asignar.
    expect(v.textContent).toMatch(/el día quedaría en 10 h de 8 h ⚠/)
    fireEvent.click(within(v).getByRole('button', { name: 'Asignar 2 rutinas' }))

    await waitFor(() => expect(mocks.asignarRutinasTurno).toHaveBeenCalledWith('b22', ['rS', 'rN']))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('soltar lo que ya está en ese día no llama a la base: lo dice', async () => {
    cargar([turno({ rutinas: [enTurno('rN')] })])
    montar()
    await screen.findByRole('region', { name: 'Calendario de Ana Pérez' })
    await waitFor(() => expect(within(paleta()).getByText(/Niveles/)).toBeTruthy())

    arrastrar(deLaPaleta('Niveles'), turnoDe(/Ana Pérez el jue 22 oct/))
    expect(screen.getByText('«Niveles» ya está en Ana Pérez el jue 22 oct.')).toBeTruthy()
    expect(mocks.asignarRutinasTurno).not.toHaveBeenCalled()
  })

  it('un día pasado o un turno cerrado no reciben nada: sin ＋ y el arrastre no asigna', async () => {
    cargar([
      turno({ bloque_id: 'bP', fecha: '2026-10-20' }),
      turno({ bloque_id: 'bC', fecha: '2026-10-24', estado: 'completado', cerrado_en: '2026-10-24T20:00:00Z' }),
    ])
    montar()
    await screen.findByRole('region', { name: 'Calendario de Ana Pérez' })
    await waitFor(() => expect(within(paleta()).getByText(/Niveles/)).toBeTruthy())

    expect(screen.queryByRole('button', { name: /Agregar rutinas a Ana Pérez el mar 20 oct/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Agregar rutinas a Ana Pérez el sáb 24 oct/ })).toBeNull()
    arrastrar(deLaPaleta('Niveles'), turnoDe(/Ana Pérez el mar 20 oct/))
    arrastrar(deLaPaleta('Niveles'), turnoDe(/Ana Pérez el sáb 24 oct/))
    expect(mocks.asignarRutinasTurno).not.toHaveBeenCalled()
  })

  it('un error de la base se muestra tal cual y no simula éxito', async () => {
    mocks.asignarRutinasTurno.mockResolvedValue({ data: null, error: { message: 'El turno del 2026-10-22 ya está cerrado', code: '55000' } })
    cargar([turno()])
    montar()
    await screen.findByRole('region', { name: 'Calendario de Ana Pérez' })
    await waitFor(() => expect(within(paleta()).getByText(/Niveles/)).toBeTruthy())

    arrastrar(deLaPaleta('Niveles'), turnoDe(/Ana Pérez el jue 22 oct/))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    const [args] = mocks.notify.mock.calls[0] as unknown as [{ title: string; text: string }]
    expect(args.title).toBe('No se pudo asignar')
    expect(args.text).toMatch(/ya está cerrado/)
    expect(mocks.onCambio).not.toHaveBeenCalled()
  })
})

describe('VistaCalendario · quitar y mover', () => {
  it('tocar una rutina sin trabajar ofrece quitarla del día', async () => {
    cargar([turno({ rutinas: [enTurno('rN')] })])
    montar()
    await screen.findByRole('region', { name: 'Calendario de Ana Pérez' })
    await waitFor(() => expect(screen.getByRole('button', { name: /^Niveles, Ana Pérez/ })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^Niveles, Ana Pérez/ }))
    await waitFor(() => expect(mocks.quitarRutinaTurno).toHaveBeenCalledWith('b22', 'rN'))
    const [args] = mocks.confirm.mock.calls[0] as unknown as [{ title: string; confirmText: string }]
    expect(args.title).toBe('¿Quitar «Niveles»?')
    expect(await screen.findByText('«Niveles» quitada de Ana Pérez el jue 22 oct.')).toBeTruthy()
  })

  it('con tareas trabajadas no se ofrece quitar: se explica dónde se corrige', async () => {
    cargar([turno({ rutinas: [enTurno('rN', 1)] })])
    montar()
    await waitFor(() => expect(screen.getByRole('button', { name: /^Niveles, Ana Pérez/ })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^Niveles, Ana Pérez/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    const [args] = mocks.notify.mock.calls[0] as unknown as [{ text: string }]
    expect(args.text).toMatch(/Ya tiene tareas trabajadas/)
    expect(args.text).toMatch(/Revisión/)
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.quitarRutinaTurno).not.toHaveBeenCalled()
  })

  it('arrastrar una rutina ya puesta a otro día la mueve: primero asigna allá, después quita de acá', async () => {
    cargar([
      turno({ rutinas: [enTurno('rN')] }),
      turno({ bloque_id: 'bL', personal_id: 'p2', personal_nombre: 'Luis Gómez', fecha: '2026-10-23' }),
    ])
    montar()
    await waitFor(() => expect(screen.getByRole('button', { name: /^Niveles, Ana Pérez/ })).toBeTruthy())

    arrastrar(screen.getByRole('button', { name: /^Niveles, Ana Pérez/ }), turnoDe(/Luis Gómez el vie 23 oct/))

    await waitFor(() => expect(mocks.quitarRutinaTurno).toHaveBeenCalledWith('b22', 'rN'))
    expect(mocks.asignarRutinasTurno).toHaveBeenCalledWith('bL', ['rN'])
    expect(mocks.asignarRutinasTurno.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.quitarRutinaTurno.mock.invocationCallOrder[0])
    expect(await screen.findByText('«Niveles» movida a Luis Gómez el vie 23 oct.')).toBeTruthy()
  })

  it('si asignar en el destino falla, NO se quita del origen', async () => {
    mocks.asignarRutinasTurno.mockResolvedValue({ data: null, error: { message: 'sin red' } })
    cargar([
      turno({ rutinas: [enTurno('rN')] }),
      turno({ bloque_id: 'b23', fecha: '2026-10-23' }),
    ])
    montar()
    await waitFor(() => expect(screen.getByRole('button', { name: /^Niveles, Ana Pérez/ })).toBeTruthy())

    arrastrar(screen.getByRole('button', { name: /^Niveles, Ana Pérez/ }), turnoDe(/Ana Pérez el vie 23 oct/))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    expect(mocks.quitarRutinaTurno).not.toHaveBeenCalled()
  })
})

describe('VistaCalendario · sin permiso de edición', () => {
  it('se ve el calendario, pero sin paleta, sin ＋ y sin quitar', async () => {
    cargar([turno({ rutinas: [enTurno('rN')] })])
    montar({ canEdit: false })
    await waitFor(() => expect(screen.getByRole('button', { name: /^Niveles, Ana Pérez/ })).toBeTruthy())

    expect(screen.queryByRole('list', { name: 'Rutinas para asignar' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Agregar rutinas a/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Niveles, Ana Pérez/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    expect(mocks.confirm).not.toHaveBeenCalled()
  })
})
