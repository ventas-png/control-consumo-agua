// Rutinas como RECORRIDO (20261102000000) desde la UI.
//
// Lo que se cubre es lo que el sandbox SQL no puede ver, porque es de la vista:
// que arrastrar un área y soltarle actividades arme el recorrido que se guarda;
// que cada gesto tenga su botón para quien no puede arrastrar (y que ↑/↓ crucen
// de un área a la vecina); que los ＋ sumen varias de una vez, en el orden
// marcado; que el tiempo se vaya acumulando por área y contra la
// jornada, avisando lo que no declara duración; que nada persista hasta
// «Guardar» y que cabecera y recorrido se guarden juntos; y que los errores de la
// base —23505 del nombre, 23503 de la rutina con historia, un fallo del
// recorrido después de crear la cabecera— se traduzcan a algo accionable.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { AreaCondominio, PlantillaTareaCargo } from '../../../../../types'

type RowError = { message: string; code?: string } | null

const mocks = vi.hoisted(() => ({
  createCondominioRowReturning: vi.fn(async () => ({
    data: { id: 'rutNueva' } as Record<string, unknown> | null,
    error: null as RowError,
  })),
  updateCondominioRow: vi.fn(async () => ({ error: null as RowError })),
  deleteCondominioRow: vi.fn(async () => ({ error: null as RowError })),
  guardarRecorridoRutina: vi.fn(async () => ({
    data: { paradas: 0, pasos: 0 } as Record<string, number> | null,
    error: null as RowError,
  })),
  fetchRutinasLimpieza: vi.fn(async () => ({
    rutinas: [] as Array<Record<string, unknown>>,
    pasos: [] as Array<Record<string, unknown>>,
    paradas: [] as Array<Record<string, unknown>>,
    horarios: [] as Array<Record<string, unknown>>,
    error: null as { message: string } | null,
  })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../../lib/supabase', () => ({
  supabase: { from: () => ({}) },
  db: { from: () => ({}) },
}))
vi.mock('../../../../../domain/condominios/tabMutations', () => ({
  createCondominioRowReturning: mocks.createCondominioRowReturning,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
  guardarRecorridoRutina: mocks.guardarRecorridoRutina,
}))
vi.mock('../../../../../domain/condominios/tabQueries', () => ({
  fetchRutinasLimpieza: mocks.fetchRutinasLimpieza,
}))
vi.mock('../../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

const { VistaRutinas } = await import('../VistaRutinas')

// ── Datos ──────────────────────────────────────────────────────────────────

function area(id: string, nombre: string, over: Partial<AreaCondominio> = {}): AreaCondominio {
  return {
    id, company_id: 'co1', project_id: 'p1', nombre, descripcion: null, icono: '🚪',
    orden: 0, activo: true, created_at: '2026-01-01T00:00:00.000Z', ...over,
  }
}
const AREAS = [area('a1', 'Apartamento 1AB'), area('a2', 'Apartamento 1C', { orden: 1 }), area('a3', 'Gradas', { orden: 2 })]

function actividad(id: string, titulo: string, min: number | null, over: Partial<PlantillaTareaCargo> = {}): PlantillaTareaCargo {
  return {
    id, company_id: 'co1', project_id: 'p1', cargo: 'conserje', titulo, descripcion: null,
    icono: '🧹', orden: 0, area_id: null, requiere_foto: false, activo: true,
    servicio: 'limpieza', duracion_estimada_min: min, created_at: '2026-01-01T00:00:00.000Z', ...over,
  } as PlantillaTareaCargo
}
const BARRER = actividad('barrer', 'Barrido de piso', 5)
const VIDRIOS = actividad('vidrios', 'Limpieza de vidrios', 2)
const SIN_DURACION = actividad('sin', 'Revisar luces', null)

function rutina(over: Record<string, unknown> = {}) {
  return {
    id: 'rut1', company_id: 'co1', project_id: 'p1', nombre: 'Rutina Lunes AM',
    descripcion: 'Tareas primera hora', area_id: null, servicio: 'limpieza',
    plantilla_horario_id: null, activa: true, orden: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}
const parada = (id: string, area_id: string, orden: number) => ({
  id, company_id: 'co1', project_id: 'p1', rutina_id: 'rut1', area_id, orden,
  created_at: '2026-01-01T00:00:00.000Z',
})
const paso = (id: string, plantilla: string, orden: number, rutina_area_id: string | null) => ({
  id, company_id: 'co1', project_id: 'p1', rutina_id: 'rut1', rutina_area_id,
  plantilla_tarea_id: plantilla, orden, obligatoria: true, notas: null,
  created_at: '2026-01-01T00:00:00.000Z',
})
const JORNADA = { id: 'h1', nombre: 'Mañana', hora_inicio: '07:00:00', hora_fin: '07:10:00' }

function cargarCon(datos: Partial<{ rutinas: unknown[]; pasos: unknown[]; paradas: unknown[]; horarios: unknown[] }>) {
  mocks.fetchRutinasLimpieza.mockResolvedValue({
    rutinas: [], pasos: [], paradas: [], horarios: [], error: null, ...datos,
  } as never)
}

function montar(props: Partial<Parameters<typeof VistaRutinas>[0]> = {}) {
  return render(
    <VistaRutinas
      plantillas={[BARRER, VIDRIOS, SIN_DURACION]}
      areas={AREAS}
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

/** Arrastra `origen` y lo suelta sobre `destino` (eventos nativos de HTML5). */
function arrastrar(origen: Element, destino: Element) {
  const dataTransfer = { setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' }
  fireEvent.dragStart(origen, { dataTransfer })
  fireEvent.dragOver(destino, { dataTransfer })
  fireEvent.drop(destino, { dataTransfer })
  fireEvent.dragEnd(origen, { dataTransfer })
}

const paleta = () => screen.getByRole('complementary', { name: 'Paleta de áreas y actividades' })
const itemPaleta = (texto: string) => within(paleta()).getByText(texto).closest('li')!
const seccionArea = (nombre: RegExp) => screen.getByRole('region', { name: nombre })
const resumen = () => screen.getByLabelText('Resumen del recorrido')

/** La rutina de la llamada `n` a guardarRecorridoRutina. */
const rutinaGuardada = (n: number) =>
  (mocks.guardarRecorridoRutina.mock.calls[n] as unknown as [string] | undefined)?.[0]

/** El recorrido que se mandó a guardar, legible: 'área:act,act'. */
function recorridoGuardado(): string[] {
  const [, rec] = mocks.guardarRecorridoRutina.mock.calls.at(-1) as unknown as
    [string, Array<{ area_id: string | null; actividades: Array<{ plantilla_tarea_id: string; obligatoria: boolean }> }>]
  return rec.map(p => `${p.area_id ?? '-'}:${p.actividades.map(a => a.plantilla_tarea_id + (a.obligatoria ? '' : '?')).join(',')}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createCondominioRowReturning.mockResolvedValue({ data: { id: 'rutNueva' }, error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.deleteCondominioRow.mockResolvedValue({ error: null })
  mocks.guardarRecorridoRutina.mockResolvedValue({ data: { paradas: 0, pasos: 0 }, error: null })
  mocks.confirm.mockResolvedValue({ isConfirmed: true })
  cargarCon({})
})
afterEach(cleanup)

// ── Tarjeta ──────────────────────────────────────────────────────────────────

describe('VistaRutinas · la tarjeta resume el recorrido', () => {
  it('muestra las áreas en orden, cuántas actividades y el tiempo total, avisando lo que no tiene duración', async () => {
    cargarCon({
      rutinas: [rutina()],
      paradas: [parada('z2', 'a2', 1), parada('z1', 'a1', 0)],
      pasos: [paso('p1', 'barrer', 0, 'z1'), paso('p2', 'vidrios', 1, 'z1'), paso('p3', 'barrer', 0, 'z2'), paso('p4', 'sin', 1, 'z2')],
    })
    montar()

    expect(await screen.findByText(/Apartamento 1AB → Apartamento 1C/)).toBeTruthy()
    expect(screen.getByText('📍 2 áreas')).toBeTruthy()
    expect(screen.getByText('📋 4 actividades')).toBeTruthy()
    expect(screen.getByText('⏱ 12 min')).toBeTruthy()
    expect(screen.getByText('⚠ 1 sin duración')).toBeTruthy()
  })

  it('pasa a horas cuando el recorrido supera los 60 minutos', async () => {
    cargarCon({ rutinas: [rutina()], paradas: [parada('z1', 'a1', 0)], pasos: [paso('p1', 'larga', 0, 'z1')] })
    montar({ plantillas: [actividad('larga', 'Lavado profundo', 105)] })
    expect(await screen.findByText('⏱ 1 h 45 min')).toBeTruthy()
  })
})

// ── Armar arrastrando ─────────────────────────────────────────────────────────

describe('VistaRutinas · armar el recorrido arrastrando', () => {
  it('primero se arrastran las áreas, después se les sueltan actividades, y se guarda todo junto', async () => {
    montar()
    fireEvent.click(await screen.findByText('+ Nueva rutina'))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Rutina Lunes AM' } })

    // El recorrido vacío recibe la primera área; el final del recorrido, la segunda.
    arrastrar(itemPaleta('Apartamento 1AB'), screen.getByText(/Arrastrá aquí la/))
    arrastrar(itemPaleta('Apartamento 1C'), screen.getByText('Soltá un área aquí para sumarla al final del recorrido'))
    expect(screen.getByRole('region', { name: 'Área 1: Apartamento 1AB' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Área 2: Apartamento 1C' })).toBeTruthy()
    // La que ya está no se puede arrastrar otra vez.
    expect(within(itemPaleta('Apartamento 1AB')).getByText('✓ En el recorrido')).toBeTruthy()

    // Actividades: soltadas sobre el área donde se hacen. La misma en dos áreas vale.
    fireEvent.click(within(paleta()).getByRole('tab', { name: /Actividades/ }))
    arrastrar(itemPaleta('Barrido de piso'), within(seccionArea(/Apartamento 1AB/)).getByText(/Soltá aquí las actividades/))
    arrastrar(itemPaleta('Limpieza de vidrios'), within(seccionArea(/Apartamento 1AB/)).getByText(/Barrido de piso/))
    arrastrar(itemPaleta('Barrido de piso'), within(seccionArea(/Apartamento 1C/)).getByText(/Soltá aquí las actividades/))

    // El tiempo se va acumulando: 1AB = 5 + 2, 1C arranca donde terminó 1AB.
    expect(resumen().textContent).toMatch(/2 áreas.*3 actividades.*Total 12 min/)
    expect(within(seccionArea(/Apartamento 1AB/)).getByText(/⏱ 7 min · acumulado 7 min/)).toBeTruthy()
    expect(within(seccionArea(/Apartamento 1C/)).getByText(/⏱ 5 min · acumulado 12 min/)).toBeTruthy()

    // Nada se guardó mientras se armaba.
    expect(mocks.createCondominioRowReturning).not.toHaveBeenCalled()
    expect(mocks.guardarRecorridoRutina).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(mocks.guardarRecorridoRutina).toHaveBeenCalled())
    const [tabla, cabecera] = mocks.createCondominioRowReturning.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('rutinas_limpieza')
    expect(cabecera).toMatchObject({ nombre: 'Rutina Lunes AM', servicio: 'limpieza', company_id: 'co1', project_id: 'p1' })
    // Jornada en null, no en cadena vacía: la FK compuesta sólo se salta con NULL.
    expect(cabecera.plantilla_horario_id).toBeNull()
    expect(rutinaGuardada(0)).toBe('rutNueva')
    // El orden de soltar sobre «Barrido de piso» (mitad inferior) lo deja detrás.
    expect(recorridoGuardado()).toEqual(['a1:barrer,vidrios', 'a2:barrer'])
  })

  it('reordenar áreas arrastrando su cabecera, y actividades entre áreas', async () => {
    cargarCon({
      rutinas: [rutina()],
      paradas: [parada('z1', 'a1', 0), parada('z2', 'a2', 1), parada('z3', 'a3', 2)],
      pasos: [paso('p1', 'barrer', 0, 'z1'), paso('p2', 'vidrios', 1, 'z1')],
    })
    montar()
    fireEvent.click(await screen.findByLabelText('Editar el recorrido de Rutina Lunes AM'))

    // 1AB al final.
    const cabecera1AB = within(seccionArea(/Apartamento 1AB/)).getByText('Apartamento 1AB').closest('[draggable="true"]')!
    arrastrar(cabecera1AB, screen.getByText('Soltá un área aquí para sumarla al final del recorrido'))
    expect(screen.getByRole('region', { name: 'Área 3: Apartamento 1AB' })).toBeTruthy()

    // «Limpieza de vidrios» de 1AB a Gradas.
    const filaVidrios = within(seccionArea(/Apartamento 1AB/)).getByText(/Limpieza de vidrios/).closest('[draggable="true"]')!
    arrastrar(filaVidrios, within(seccionArea(/Gradas/)).getByText(/Soltá aquí las actividades/))

    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(mocks.guardarRecorridoRutina).toHaveBeenCalled())
    expect(mocks.createCondominioRowReturning).not.toHaveBeenCalled()
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('rutinas_limpieza', 'rut1', expect.objectContaining({ nombre: 'Rutina Lunes AM' }))
    expect(recorridoGuardado()).toEqual(['a2:', 'a3:vidrios', 'a1:barrer'])
  })

  it('la misma actividad dos veces en un área no entra, y se explica', async () => {
    cargarCon({ rutinas: [rutina()], paradas: [parada('z1', 'a1', 0)], pasos: [paso('p1', 'barrer', 0, 'z1')] })
    montar()
    fireEvent.click(await screen.findByLabelText('Editar el recorrido de Rutina Lunes AM'))

    arrastrar(itemPaleta('Barrido de piso'), within(seccionArea(/Apartamento 1AB/)).getByText(/Barrido de piso/))
    expect(screen.getByText('«Barrido de piso» ya está en «Apartamento 1AB».')).toBeTruthy()
    expect(within(seccionArea(/Apartamento 1AB/)).getAllByText(/Barrido de piso/)).toHaveLength(1)
  })
})

// ── Sin arrastre ──────────────────────────────────────────────────────────────

describe('VistaRutinas · cada gesto tiene su botón (táctil y teclado)', () => {
  it('＋ agrega áreas al final y actividades al área seleccionada; ↑/↓ cruzan al área vecina', async () => {
    montar()
    fireEvent.click(await screen.findByText('+ Nueva rutina'))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Botones' } })

    fireEvent.click(screen.getByLabelText('Agregar Apartamento 1AB al recorrido'))
    fireEvent.click(screen.getByLabelText('Agregar Gradas al recorrido'))
    // La última agregada queda seleccionada: ahí van las actividades.
    fireEvent.click(within(paleta()).getByRole('tab', { name: /Actividades/ }))
    fireEvent.click(screen.getByLabelText('Agregar Barrido de piso a Gradas'))
    // Seleccionar otra área cambia el destino del ＋.
    fireEvent.click(within(seccionArea(/Apartamento 1AB/)).getByText('Apartamento 1AB'))
    fireEvent.click(screen.getByLabelText('Agregar Limpieza de vidrios a Apartamento 1AB'))

    // Bajar la última de 1AB la lleva al principio de Gradas.
    fireEvent.click(within(seccionArea(/Apartamento 1AB/)).getByLabelText('Bajar Limpieza de vidrios'))
    // Y Gradas sube por encima de 1AB.
    fireEvent.click(screen.getByLabelText('Subir Gradas'))
    // La primera área no sube más; su primera actividad, tampoco (no hay vecina arriba).
    expect((screen.getByLabelText('Subir Gradas') as HTMLButtonElement).disabled).toBe(true)
    expect((within(seccionArea(/Gradas/)).getByLabelText('Subir Limpieza de vidrios') as HTMLButtonElement).disabled).toBe(true)
    // Opcional.
    fireEvent.click(within(seccionArea(/Gradas/)).getByLabelText('Volver opcional Barrido de piso'))

    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(mocks.guardarRecorridoRutina).toHaveBeenCalled())
    expect(recorridoGuardado()).toEqual(['a3:vidrios,barrer?', 'a1:'])
  })

  it('sin área seleccionada el ＋ de actividades está apagado y dice por qué', async () => {
    montar()
    fireEvent.click(await screen.findByText('+ Nueva rutina'))
    fireEvent.click(within(paleta()).getByRole('tab', { name: /Actividades/ }))
    const boton = screen.getByLabelText('Agregar Barrido de piso (primero seleccioná un área)') as HTMLButtonElement
    expect(boton.disabled).toBe(true)
  })

  it('quitar un área se lleva sus actividades (del borrador; no toca el catálogo)', async () => {
    cargarCon({ rutinas: [rutina()], paradas: [parada('z1', 'a1', 0), parada('z2', 'a2', 1)], pasos: [paso('p1', 'barrer', 0, 'z1')] })
    montar()
    fireEvent.click(await screen.findByLabelText('Editar el recorrido de Rutina Lunes AM'))
    fireEvent.click(screen.getByLabelText('Quitar Apartamento 1AB del recorrido'))
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(mocks.guardarRecorridoRutina).toHaveBeenCalled())
    expect(recorridoGuardado()).toEqual(['a2:'])
    expect(mocks.deleteCondominioRow).not.toHaveBeenCalled()
  })
})

// ── Varias de una vez ─────────────────────────────────────────────────────────

describe('VistaRutinas · ＋ agrega varias de una vez y después se ordenan con las flechas', () => {
  const ventana = (nombre: string | RegExp) => screen.getByRole('dialog', { name: nombre })
  const casilla = (v: HTMLElement, nombre: RegExp) => within(v).getByRole('checkbox', { name: nombre }) as HTMLInputElement

  it('«＋ Agregar áreas»: se marcan varias, entran al final en el orden marcado, y las que ya están se ven apagadas', async () => {
    cargarCon({ rutinas: [rutina()], paradas: [parada('z2', 'a2', 0)] })
    montar()
    fireEvent.click(await screen.findByLabelText('Editar el recorrido de Rutina Lunes AM'))

    fireEvent.click(screen.getByRole('button', { name: '＋ Agregar áreas' }))
    const v = ventana('Agregar áreas al recorrido')
    // 1C ya está: marcada y apagada, no se puede volver a sumar.
    expect(casilla(v, /Apartamento 1C/).checked).toBe(true)
    expect(casilla(v, /Apartamento 1C/).disabled).toBe(true)
    const agregar = () => within(v).getByRole('button', { name: /^Agregar/ }) as HTMLButtonElement
    expect(agregar().disabled).toBe(true)

    // El orden en que se marcan es el orden en que entran: Gradas antes que 1AB.
    fireEvent.click(casilla(v, /Gradas/))
    fireEvent.click(casilla(v, /Apartamento 1AB/))
    expect(within(v).getByText('2 marcadas')).toBeTruthy()
    fireEvent.click(agregar())

    // Se cierra la lista; el editor sigue abierto debajo.
    expect(screen.queryByRole('dialog', { name: 'Agregar áreas al recorrido' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Editar «Rutina Lunes AM»' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Área 1: Apartamento 1C' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Área 2: Gradas' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Área 3: Apartamento 1AB' })).toBeTruthy()
    expect(screen.getByText(/2 áreas agregadas al final del recorrido/)).toBeTruthy()

    // Y se acomodan con las flechas: 1AB sube por encima de Gradas.
    fireEvent.click(screen.getByLabelText('Subir Apartamento 1AB'))
    expect(mocks.guardarRecorridoRutina).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(mocks.guardarRecorridoRutina).toHaveBeenCalled())
    expect(recorridoGuardado()).toEqual(['a2:', 'a1:', 'a3:'])
  })

  it('«＋ Actividades» de un área: marca varias del catálogo, dice cuánto suman, y entran al final de ESA área', async () => {
    const PULIR = actividad('pulir', 'Pulido de piso', 20, { servicio: 'mantenimiento' })
    cargarCon({
      rutinas: [rutina()],
      paradas: [parada('z1', 'a1', 0), parada('z2', 'a2', 1)],
      pasos: [paso('p1', 'barrer', 0, 'z1')],
    })
    montar({ plantillas: [BARRER, VIDRIOS, SIN_DURACION, PULIR] })
    fireEvent.click(await screen.findByLabelText('Editar el recorrido de Rutina Lunes AM'))

    fireEvent.click(screen.getByLabelText('Agregar actividades a Apartamento 1AB'))
    const v = ventana('Actividades en «Apartamento 1AB»')
    expect(casilla(v, /Barrido de piso/).disabled).toBe(true)
    // Arranca filtrada por limpieza, como la paleta; con «Todos» aparece el resto.
    expect(within(v).queryByRole('checkbox', { name: /Pulido de piso/ })).toBeNull()
    fireEvent.change(within(v).getByLabelText('Servicio'), { target: { value: '' } })

    fireEvent.click(casilla(v, /Revisar luces/))
    fireEvent.click(casilla(v, /Limpieza de vidrios/))
    fireEvent.click(casilla(v, /Pulido de piso/))
    // El tiempo de lo marcado, avisando lo que no declara duración.
    expect(v.textContent).toMatch(/Suman 22 min · ⚠ 1 sin duración/)
    fireEvent.click(within(v).getByRole('button', { name: 'Agregar 3 actividades' }))

    expect(screen.queryByRole('dialog', { name: 'Actividades en «Apartamento 1AB»' })).toBeNull()
    expect(screen.getByText('3 actividades agregadas a «Apartamento 1AB». Ordenalas con ↑ ↓.')).toBeTruthy()
    // Sólo en 1AB; 1C no se tocó.
    expect(within(seccionArea(/Apartamento 1C/)).getByText(/Soltá aquí las actividades/)).toBeTruthy()

    // Ordenar después: vidrios sube por encima de «Revisar luces».
    fireEvent.click(within(seccionArea(/Apartamento 1AB/)).getByLabelText('Subir Limpieza de vidrios'))
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(mocks.guardarRecorridoRutina).toHaveBeenCalled())
    expect(recorridoGuardado()).toEqual(['a1:barrer,vidrios,sin,pulir', 'a2:'])
  })

  it('las marcas sobreviven a la búsqueda; «Marcar las que se ven»; cancelar no agrega nada', async () => {
    montar()
    fireEvent.click(await screen.findByText('+ Nueva rutina'))

    fireEvent.click(screen.getByRole('button', { name: '＋ Agregar áreas' }))
    let v = ventana('Agregar áreas al recorrido')
    fireEvent.change(within(v).getByLabelText('Buscar área'), { target: { value: 'apartamento' } })
    expect(within(v).queryByRole('checkbox', { name: /Gradas/ })).toBeNull()
    fireEvent.click(within(v).getByRole('button', { name: 'Marcar las que se ven' }))
    fireEvent.change(within(v).getByLabelText('Buscar área'), { target: { value: '' } })
    fireEvent.click(casilla(v, /Gradas/))
    expect(within(v).getByText('3 marcadas')).toBeTruthy()

    fireEvent.click(within(v).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog', { name: 'Agregar áreas al recorrido' })).toBeNull()
    expect(screen.queryByRole('region', { name: /^Área/ })).toBeNull()

    // Al volver a abrir, sin marcas; «Marcar todas» sin filtro, y Esc también cierra sin agregar.
    fireEvent.click(screen.getByRole('button', { name: '＋ Agregar áreas' }))
    v = ventana('Agregar áreas al recorrido')
    expect(within(v).getByText('Ninguna marcada')).toBeTruthy()
    fireEvent.click(within(v).getByRole('button', { name: 'Marcar todas' }))
    expect(within(v).getByText('3 marcadas')).toBeTruthy()
    // Esc cierra sólo la lista de arriba, no también el editor.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Agregar áreas al recorrido' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Nueva rutina' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: /^Área/ })).toBeNull()
  })

  it('sin permiso de edición no aparecen los ＋', async () => {
    cargarCon({ rutinas: [rutina()], paradas: [parada('z1', 'a1', 0)] })
    montar({ canCreate: false, canEdit: false, canDelete: false })
    fireEvent.click(await screen.findByLabelText('Ver el recorrido de Rutina Lunes AM'))
    expect(screen.queryByRole('button', { name: '＋ Agregar áreas' })).toBeNull()
    expect(screen.queryByLabelText('Agregar actividades a Apartamento 1AB')).toBeNull()
  })
})

// ── Tiempo ────────────────────────────────────────────────────────────────────

describe('VistaRutinas · el tiempo contra la jornada', () => {
  it('con jornada, cada área dice su horario estimado y el total avisa si no cabe', async () => {
    cargarCon({
      rutinas: [rutina({ plantilla_horario_id: 'h1', horario_nombre: 'Mañana' })],
      paradas: [parada('z1', 'a1', 0), parada('z2', 'a2', 1)],
      pasos: [paso('p1', 'barrer', 0, 'z1'), paso('p2', 'vidrios', 1, 'z1'), paso('p3', 'barrer', 0, 'z2')],
      horarios: [JORNADA],
    })
    montar()
    fireEvent.click(await screen.findByLabelText('Editar el recorrido de Rutina Lunes AM'))

    expect(within(seccionArea(/Apartamento 1AB/)).getByText(/07:00 → 07:07/)).toBeTruthy()
    expect(within(seccionArea(/Apartamento 1C/)).getByText(/07:07 → 07:12/)).toBeTruthy()
    // 12 min en una jornada de 10.
    expect(resumen().textContent).toMatch(/Excede la jornada «Mañana» \(10 min\) por 2 min/)
  })

  it('el grupo de pasos sin área (rutinas de antes) se ve primero y se puede vaciar', async () => {
    cargarCon({
      rutinas: [rutina()],
      paradas: [parada('z1', 'a1', 0)],
      pasos: [paso('p0', 'sin', 0, null), paso('p1', 'barrer', 0, 'z1')],
    })
    montar()
    fireEvent.click(await screen.findByLabelText('Editar el recorrido de Rutina Lunes AM'))

    const legado = screen.getByRole('region', { name: 'Actividades sin área' })
    expect(within(legado).getByText(/Revisar luces/)).toBeTruthy()
    fireEvent.click(within(legado).getByLabelText('Bajar Revisar luces'))
    expect(screen.queryByRole('region', { name: 'Actividades sin área' })).toBeNull()

    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(mocks.guardarRecorridoRutina).toHaveBeenCalled())
    expect(recorridoGuardado()).toEqual(['a1:sin,barrer'])
  })
})

// ── Guardado y errores ────────────────────────────────────────────────────────

describe('VistaRutinas · guardado y errores', () => {
  it('cancelar sin cambios cierra; con cambios pide confirmación y no persiste nada', async () => {
    montar()
    fireEvent.click(await screen.findByText('+ Nueva rutina'))
    fireEvent.click(screen.getByText('Cancelar'))
    await waitFor(() => expect(screen.queryByLabelText('Nombre')).toBeNull())
    expect(mocks.confirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('+ Nueva rutina'))
    fireEvent.click(screen.getByLabelText('Agregar Gradas al recorrido'))
    fireEvent.click(screen.getByText('Cancelar'))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    expect(mocks.createCondominioRowReturning).not.toHaveBeenCalled()
    expect(mocks.guardarRecorridoRutina).not.toHaveBeenCalled()
  })

  it('el editor es una ventana (pantalla completa en el teléfono): Esc con cambios pregunta, y mientras guarda no se cierra', async () => {
    let terminar!: (v: { data: Record<string, number>; error: null }) => void
    mocks.guardarRecorridoRutina.mockImplementationOnce(() => new Promise(res => { terminar = res }) as never)
    montar()
    fireEvent.click(await screen.findByText('+ Nueva rutina'))
    const ventana = screen.getByRole('dialog', { name: 'Nueva rutina' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)

    // Con cambios, Esc pide confirmación; si no se confirma, el borrador sigue.
    mocks.confirm.mockResolvedValueOnce({ isConfirmed: false })
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Vespertina' } })
    fireEvent.click(screen.getByLabelText('Agregar Gradas al recorrido'))
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('dialog', { name: 'Nueva rutina' })).toBeTruthy()

    // Mientras guarda, ni Esc ni la X la cierran ni preguntan.
    fireEvent.click(within(ventana).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.guardarRecorridoRutina).toHaveBeenCalledTimes(1))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(ventana).getByLabelText('Cerrar modal'))
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: 'Nueva rutina' })).toBeTruthy()

    terminar({ data: { paradas: 1, pasos: 0 }, error: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('el choque de nombre (23505) se explica y el recorrido no se intenta', async () => {
    mocks.createCondominioRowReturning.mockResolvedValue({
      data: null,
      error: { message: 'duplicate key value violates unique constraint "uq_rutinas_nombre_normalizado"', code: '23505' },
    })
    montar()
    fireEvent.click(await screen.findByText('+ Nueva rutina'))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Matutina' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    const [args] = mocks.notify.mock.calls[0] as unknown as [{ title: string; text: string }]
    expect(args.title).toBe('Nombre repetido')
    expect(args.text).toMatch(/Ya existe una rutina con ese nombre/)
    expect(args.text).not.toMatch(/duplicate key/)
    expect(mocks.guardarRecorridoRutina).not.toHaveBeenCalled()
  })

  it('sin nombre no se llama a la base', async () => {
    montar()
    fireEvent.click(await screen.findByText('+ Nueva rutina'))
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    expect(mocks.createCondominioRowReturning).not.toHaveBeenCalled()
  })

  it('si el recorrido falla después de crear la cabecera, reintentar no duplica la rutina', async () => {
    mocks.guardarRecorridoRutina.mockResolvedValueOnce({ data: null, error: { message: 'sin red' } })
    montar()
    fireEvent.click(await screen.findByText('+ Nueva rutina'))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Nocturna' } })
    fireEvent.click(screen.getByLabelText('Agregar Gradas al recorrido'))
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    const [args] = mocks.notify.mock.calls[0] as unknown as [{ title: string; text: string }]
    expect(args.title).toBe('No se pudo guardar el recorrido')
    expect(args.text).toMatch(/volvé a guardar para reintentar/)
    // El borrador sigue ahí.
    expect(screen.getByRole('region', { name: 'Área 1: Gradas' })).toBeTruthy()

    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(mocks.guardarRecorridoRutina).toHaveBeenCalledTimes(2))
    expect(mocks.createCondominioRowReturning).toHaveBeenCalledTimes(1)
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('rutinas_limpieza', 'rutNueva', expect.anything())
    expect(rutinaGuardada(1)).toBe('rutNueva')
  })

  it('un fallo de carga se muestra y ofrece reintentar', async () => {
    mocks.fetchRutinasLimpieza.mockResolvedValue({
      rutinas: [], pasos: [], paradas: [], horarios: [], error: { message: 'sin red' },
    })
    montar()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/sin red/)).toBeTruthy()
    expect(screen.getByText('Reintentar')).toBeTruthy()
  })
})

describe('VistaRutinas · permisos', () => {
  it('sin canEdit el recorrido se ve pero no se arma ni se guarda', async () => {
    cargarCon({ rutinas: [rutina()], paradas: [parada('z1', 'a1', 0)], pasos: [paso('p1', 'barrer', 0, 'z1')] })
    montar({ canCreate: false, canEdit: false, canDelete: false })

    expect(screen.queryByText('+ Nueva rutina')).toBeNull()
    fireEvent.click(await screen.findByLabelText('Ver el recorrido de Rutina Lunes AM'))
    expect(within(seccionArea(/Apartamento 1AB/)).getByText(/Barrido de piso/)).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: 'Paleta de áreas y actividades' })).toBeNull()
    expect(screen.queryByLabelText('Quitar Barrido de piso de Apartamento 1AB')).toBeNull()
    expect(screen.queryByText('Guardar')).toBeNull()
    expect(screen.queryByLabelText('Eliminar Rutina Lunes AM')).toBeNull()
  })
})

describe('VistaRutinas · a quién y qué día se asigna en el Calendario', () => {
  // 20261103000000: «Generar tareas» por jornada le daba la rutina a TODOS los
  // turnos de su jornada. Ya no se ofrece: la rutina se asigna a una persona en
  // un día desde el Calendario.
  it('no ofrece «Generar tareas» y dice dónde se asigna', async () => {
    montar()
    await waitFor(() => expect(mocks.fetchRutinasLimpieza).toHaveBeenCalled())
    expect(screen.queryByText(/Generar tareas/)).toBeNull()
    expect(screen.queryByLabelText('Desde')).toBeNull()
    expect(screen.getByText(/se asigna en el Calendario/)).toBeTruthy()
  })
})

describe('VistaRutinas · la rutina que ya generó trabajo', () => {
  it('explica el 23503 en vez de mostrar el error de la FK', async () => {
    cargarCon({ rutinas: [rutina()] })
    mocks.deleteCondominioRow.mockResolvedValue({
      error: {
        message: 'update or delete on table "rutinas_limpieza" violates foreign key constraint "tareas_bloque_rutina_fk"',
        code: '23503',
      },
    })
    montar()
    fireEvent.click(await screen.findByLabelText('Eliminar Rutina Lunes AM'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    const [args] = mocks.notify.mock.calls[0] as unknown as [{ title: string; text: string }]
    expect(args.title).toBe('La rutina ya generó trabajo')
    expect(args.text).toMatch(/Desactivala en vez de borrarla/)
    expect(args.text).not.toMatch(/foreign key constraint/)
  })
})
