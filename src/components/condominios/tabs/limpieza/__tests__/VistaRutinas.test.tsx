// Armado de rutinas (20260907000200) desde la UI.
//
// Lo que se cubre es lo que el sandbox SQL no puede ver, porque es de la vista:
// que el total de duración sume y avise cuando una actividad no la declara; que
// el selector sea el catálogo compartido en modo selección (sin sus acciones de
// escritura); que los pasos se guarden al instante y la cabecera no; que
// reordenar intercambie el orden con el vecino en vez de renumerar; y que el
// choque de nombre —23505, el índice único por nombre normalizado— se traduzca
// a algo que quien captura pueda accionar, en vez del mensaje crudo de Postgres.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type {
  AreaCondominio, ItemInventario, PlantillaTareaCargo, SuministroCondominio,
} from '../../../../../types'

type RowError = { message: string; code?: string } | null

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null as RowError })),
  updateCondominioRow: vi.fn(async () => ({ error: null as RowError })),
  deleteCondominioRow: vi.fn(async () => ({ error: null as RowError })),
  fetchRutinasLimpieza: vi.fn(async () => ({
    rutinas: [] as Array<Record<string, unknown>>,
    pasos: [] as Array<Record<string, unknown>>,
    horarios: [] as Array<Record<string, unknown>>,
    error: null as { message: string } | null,
  })),
  fetchRecursosPlantillas: vi.fn(async () => ({
    suministros: [] as Array<Record<string, unknown>>,
    herramientas: [] as Array<Record<string, unknown>>,
    error: null as { message: string } | null,
  })),
  openPromptDialog: vi.fn(async () => null as Record<string, string> | null),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../../lib/supabase', () => ({
  supabase: { from: () => ({}) },
  db: { from: () => ({}) },
}))
vi.mock('../../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../../../domain/condominios/tabQueries', () => ({
  fetchRutinasLimpieza: mocks.fetchRutinasLimpieza,
  fetchRecursosPlantillas: mocks.fetchRecursosPlantillas,
}))
vi.mock('../../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../../../shared/PromptDialog', () => ({ openPromptDialog: mocks.openPromptDialog }))

const { VistaRutinas } = await import('../VistaRutinas')

// ── Datos ──────────────────────────────────────────────────────────────────

const area: AreaCondominio = {
  id: 'area1', company_id: 'co1', project_id: 'p1', nombre: 'Piscina',
  descripcion: null, icono: '🏊', orden: 0, activo: true,
  created_at: '2026-01-01T00:00:00.000Z',
}

function actividad(over: Partial<PlantillaTareaCargo> = {}): PlantillaTareaCargo {
  return {
    id: 'act1', company_id: 'co1', project_id: 'p1', cargo: 'limpieza',
    titulo: 'Barrer el borde', descripcion: null, icono: '🧹', orden: 0,
    area_id: 'area1', requiere_foto: false, activo: true,
    servicio: 'limpieza', duracion_estimada_min: 30,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  } as PlantillaTareaCargo
}

function rutina(over: Record<string, unknown> = {}) {
  return {
    id: 'rut1', company_id: 'co1', project_id: 'p1', nombre: 'Matutina de piscina',
    descripcion: null, area_id: 'area1', servicio: 'limpieza',
    plantilla_horario_id: null, activa: true, orden: 0,
    created_at: '2026-01-01T00:00:00.000Z', area_nombre: 'Piscina',
    ...over,
  }
}

function paso(over: Record<string, unknown> = {}) {
  return {
    id: 'paso1', company_id: 'co1', project_id: 'p1', rutina_id: 'rut1',
    plantilla_tarea_id: 'act1', orden: 0, obligatoria: true, notas: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function montar(props: Partial<Parameters<typeof VistaRutinas>[0]> = {}) {
  return render(
    <VistaRutinas
      plantillas={[actividad()]}
      areas={[area]}
      suministros={[] as SuministroCondominio[]}
      inventario={[] as ItemInventario[]}
      proyectoId="p1"
      companyId="co1"
      canCreate
      canEdit
      canDelete
      onRefresh={() => {}}
      {...props}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.deleteCondominioRow.mockResolvedValue({ error: null })
  mocks.confirm.mockResolvedValue({ isConfirmed: true })
  mocks.fetchRutinasLimpieza.mockResolvedValue({
    rutinas: [], pasos: [], horarios: [], error: null,
  })
})
afterEach(cleanup)

describe('VistaRutinas · lo que la rutina le dice a quien la arma', () => {
  it('suma la duración de los pasos y avisa de los que no la declaran', async () => {
    mocks.fetchRutinasLimpieza.mockResolvedValue({
      rutinas: [rutina()],
      pasos: [paso(), paso({ id: 'paso2', plantilla_tarea_id: 'act2', orden: 1 })],
      horarios: [], error: null,
    })
    montar({
      plantillas: [
        actividad({ duracion_estimada_min: 45 }),
        // Sin duración: el total se quedaría corto en silencio.
        actividad({ id: 'act2', titulo: 'Revisar cloro', duracion_estimada_min: null }),
      ],
    })

    // 45 min de la única que la declara.
    expect(await screen.findByText(/⏱ 45 min/)).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Pasos de Matutina de piscina'))
    expect(await screen.findByText(/1 sin duración/)).toBeTruthy()
  })

  it('convierte los minutos a horas cuando pasa de 60', async () => {
    mocks.fetchRutinasLimpieza.mockResolvedValue({
      rutinas: [rutina()],
      pasos: [paso(), paso({ id: 'paso2', plantilla_tarea_id: 'act2', orden: 1 })],
      horarios: [], error: null,
    })
    montar({
      plantillas: [
        actividad({ duracion_estimada_min: 60 }),
        actividad({ id: 'act2', titulo: 'Revisar cloro', duracion_estimada_min: 45 }),
      ],
    })
    expect(await screen.findByText(/⏱ 1 h 45 min/)).toBeTruthy()
  })

  it('marca la actividad desactivada en el catálogo sin quitarla de la rutina', async () => {
    mocks.fetchRutinasLimpieza.mockResolvedValue({
      rutinas: [rutina()], pasos: [paso()], horarios: [], error: null,
    })
    montar({ plantillas: [actividad({ activo: false })] })

    fireEvent.click(await screen.findByLabelText('Pasos de Matutina de piscina'))
    expect(await screen.findByTitle(/desactivada en el catálogo/)).toBeTruthy()
  })
})

describe('VistaRutinas · el selector es el catálogo compartido', () => {
  it('abre ActividadesCatalog en modo selección, sin sus acciones de escritura', async () => {
    mocks.fetchRutinasLimpieza.mockResolvedValue({
      rutinas: [rutina()], pasos: [], horarios: [], error: null,
    })
    montar()

    fireEvent.click(await screen.findByLabelText('Pasos de Matutina de piscina'))
    fireEvent.click(await screen.findByText('➕ Agregar actividades del catálogo'))

    // El catálogo compartido aparece con su botón de elegir…
    expect(await screen.findByLabelText('Agregar Barrer el borde a la rutina')).toBeTruthy()
    // …y SIN las acciones que administrarían el catálogo desde aquí. Se
    // comprueba por el aria-label de la ACTIVIDAD: «✏️ Editar» a secas también
    // lo tiene la tarjeta de la rutina, y buscarlo por texto daría un falso
    // positivo tranquilizador.
    expect(screen.queryByText('+ Nueva actividad')).toBeNull()
    expect(screen.queryByLabelText('Eliminar Barrer el borde')).toBeNull()
    // El único «Editar» de la pantalla es el de la rutina, no el del catálogo.
    expect(screen.getAllByText('✏️ Editar')).toHaveLength(1)
  })

  it('agregar un paso lo persiste al instante, al final del orden', async () => {
    mocks.fetchRutinasLimpieza.mockResolvedValue({
      rutinas: [rutina()], pasos: [paso()], horarios: [], error: null,
    })
    montar({
      plantillas: [actividad(), actividad({ id: 'act2', titulo: 'Revisar cloro' })],
    })

    fireEvent.click(await screen.findByLabelText('Pasos de Matutina de piscina'))
    fireEvent.click(await screen.findByText('➕ Agregar actividades del catálogo'))
    fireEvent.click(await screen.findByLabelText('Agregar Revisar cloro a la rutina'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalled())
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as
      [string, Record<string, unknown>]
    expect(tabla).toBe('rutina_actividades')
    expect(payload.rutina_id).toBe('rut1')
    expect(payload.plantilla_tarea_id).toBe('act2')
    // Ya había un paso: el nuevo va detrás.
    expect(payload.orden).toBe(1)
  })

  it('la actividad ya elegida no ofrece agregarse otra vez', async () => {
    mocks.fetchRutinasLimpieza.mockResolvedValue({
      rutinas: [rutina()], pasos: [paso()], horarios: [], error: null,
    })
    montar()

    fireEvent.click(await screen.findByLabelText('Pasos de Matutina de piscina'))
    fireEvent.click(await screen.findByText('➕ Agregar actividades del catálogo'))

    expect(await screen.findByText('✓ En la rutina')).toBeTruthy()
    expect(screen.queryByLabelText('Agregar Barrer el borde a la rutina')).toBeNull()
  })
})

describe('VistaRutinas · reordenar y quitar pasos', () => {
  it('mover un paso intercambia el orden con su vecino, sin renumerar el resto', async () => {
    mocks.fetchRutinasLimpieza.mockResolvedValue({
      rutinas: [rutina()],
      pasos: [
        paso({ id: 'paso1', orden: 0 }),
        paso({ id: 'paso2', plantilla_tarea_id: 'act2', orden: 5 }),
      ],
      horarios: [], error: null,
    })
    montar({
      plantillas: [actividad(), actividad({ id: 'act2', titulo: 'Revisar cloro' })],
    })

    fireEvent.click(await screen.findByLabelText('Pasos de Matutina de piscina'))
    fireEvent.click(await screen.findByLabelText('Bajar Barrer el borde'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(2))
    const llamadas = mocks.updateCondominioRow.mock.calls as unknown as
      Array<[string, string, Record<string, unknown>]>
    // Cada uno se queda con el orden del otro: dos updates, no una renumeración.
    expect(llamadas.map(([, id, patch]) => [id, patch.orden]).sort())
      .toEqual([['paso1', 5], ['paso2', 0]])
  })

  it('el primero no sube y el último no baja', async () => {
    mocks.fetchRutinasLimpieza.mockResolvedValue({
      rutinas: [rutina()],
      pasos: [paso({ id: 'paso1', orden: 0 }), paso({ id: 'paso2', plantilla_tarea_id: 'act2', orden: 1 })],
      horarios: [], error: null,
    })
    montar({
      plantillas: [actividad(), actividad({ id: 'act2', titulo: 'Revisar cloro' })],
    })

    fireEvent.click(await screen.findByLabelText('Pasos de Matutina de piscina'))
    expect((await screen.findByLabelText('Subir Barrer el borde') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Bajar Revisar cloro') as HTMLButtonElement).disabled).toBe(true)
  })

  it('quitar un paso borra la fila puente, no la actividad del catálogo', async () => {
    mocks.fetchRutinasLimpieza.mockResolvedValue({
      rutinas: [rutina()], pasos: [paso()], horarios: [], error: null,
    })
    montar()

    fireEvent.click(await screen.findByLabelText('Pasos de Matutina de piscina'))
    fireEvent.click(await screen.findByLabelText('Quitar Barrer el borde de la rutina'))

    await waitFor(() => expect(mocks.deleteCondominioRow).toHaveBeenCalled())
    expect(mocks.deleteCondominioRow).toHaveBeenCalledWith('rutina_actividades', 'paso1')
  })
})

describe('VistaRutinas · guardado y errores', () => {
  it('la cabecera es un borrador: cancelar no persiste nada', async () => {
    montar()
    fireEvent.click(await screen.findByText('+ Nueva rutina'))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Nocturna' } })
    fireEvent.click(screen.getByText('Cancelar'))

    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
  })

  it('la rutina nueva nace con servicio limpieza y el tenant de la pantalla', async () => {
    montar()
    fireEvent.click(await screen.findByText('+ Nueva rutina'))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Nocturna' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalled())
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as
      [string, Record<string, unknown>]
    expect(tabla).toBe('rutinas_limpieza')
    expect(payload).toMatchObject({
      nombre: 'Nocturna', servicio: 'limpieza', company_id: 'co1', project_id: 'p1',
    })
    // Área y jornada quedan en null, no en cadena vacía: la FK compuesta sólo
    // se salta con NULL (MATCH SIMPLE); '' reventaría como uuid inválido.
    expect(payload.area_id).toBeNull()
    expect(payload.plantilla_horario_id).toBeNull()
  })

  it('el choque de nombre (23505) se explica en vez de mostrar el error de Postgres', async () => {
    mocks.createCondominioRow.mockResolvedValue({
      error: { message: 'duplicate key value violates unique constraint "uq_rutinas_nombre_normalizado"', code: '23505' },
    })
    montar()
    fireEvent.click(await screen.findByText('+ Nueva rutina'))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Matutina de piscina' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    const [args] = mocks.notify.mock.calls[0] as unknown as [{ title: string; text: string }]
    expect(args.title).toBe('Nombre repetido')
    expect(args.text).toMatch(/Ya existe una rutina con ese nombre/)
    expect(args.text).not.toMatch(/duplicate key/)
  })

  it('sin nombre no se llama a la base', async () => {
    montar()
    fireEvent.click(await screen.findByText('+ Nueva rutina'))
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
  })

  it('un fallo de carga se muestra y ofrece reintentar', async () => {
    mocks.fetchRutinasLimpieza.mockResolvedValue({
      rutinas: [], pasos: [], horarios: [], error: { message: 'sin red' },
    })
    montar()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/sin red/)).toBeTruthy()
    expect(screen.getByText('Reintentar')).toBeTruthy()
  })
})

describe('VistaRutinas · permisos', () => {
  it('sin canEdit no se ofrece armar ni reordenar', async () => {
    mocks.fetchRutinasLimpieza.mockResolvedValue({
      rutinas: [rutina()], pasos: [paso()], horarios: [], error: null,
    })
    montar({ canCreate: false, canEdit: false, canDelete: false })

    expect(screen.queryByText('+ Nueva rutina')).toBeNull()
    fireEvent.click(await screen.findByLabelText('Pasos de Matutina de piscina'))
    // Los pasos se ven…
    expect(await screen.findByText(/Barrer el borde/)).toBeTruthy()
    // …pero no se tocan.
    expect(screen.queryByText('➕ Agregar actividades del catálogo')).toBeNull()
    expect(screen.queryByLabelText('Quitar Barrer el borde de la rutina')).toBeNull()
    expect(screen.queryByLabelText('Eliminar Matutina de piscina')).toBeNull()
  })
})
