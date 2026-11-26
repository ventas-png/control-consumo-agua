// Ejecución guiada de un turno: antes de iniciar se confirma lo que hay que
// tener a mano, y en curso se avanza una tarjeta por vez, por paradas, con un
// botón que guarda y sigue.
//
// Lo que se cubre es la VISTA: que «▶ Iniciar» ya no arranque de un clic, que
// la preparación salga de las tareas (herramientas, insumos, indicaciones,
// cámara), que «Listo · Siguiente» use el mismo cierre de la lista y avance
// sólo si guardó, y que el final ofrezca cerrar el turno. Las reglas puras
// están en domain/condominios/__tests__/ejecucionGuiada.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react'
import type {
  AreaCondominio, BloqueTurno, PersonalCondominio, PlantillaTareaCargo, TareaBloque,
} from '../../../../types'

type RowError = { message: string; code?: string } | null

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null as RowError })),
  createCondominioRowReturning: vi.fn(async () => ({ data: null, error: null as RowError })),
  updateCondominioRow: vi.fn(async () => ({ error: null as RowError })),
  deleteCondominioRow: vi.fn(async () => ({ error: null as RowError })),
  cerrarTareaYConsumir: vi.fn(async () => ({
    data: { consumidos: 0, no_usados: 0, sin_stock: [] as unknown[] },
    error: null as RowError,
  })),
  fetchInsumosDeTareas: vi.fn(async () => ({ insumos: [] as unknown[], error: null })),
  fetchHerramientasDelTurno: vi.fn(async () => ({
    herramientas: [] as unknown[], error: null as { message: string } | null,
  })),
  openPromptDialog: vi.fn(async () => null as Record<string, string> | null),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: () => ({}) },
  db: { from: () => ({}) },
}))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  createCondominioRowReturning: mocks.createCondominioRowReturning,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
  cerrarTareaYConsumir: mocks.cerrarTareaYConsumir,
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({
  fetchInsumosDeTareas: mocks.fetchInsumosDeTareas,
  fetchHerramientasDelTurno: mocks.fetchHerramientasDelTurno,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: mocks.openPromptDialog }))
vi.mock('../../../shared/ImageUploader', () => ({
  MultiImageUploader: () => null,
  ImageUploader: () => null,
}))

const { TareasPersonalTab } = await import('../TareasPersonalTab')

// ── Datos ──────────────────────────────────────────────────────────────────

const HOY = new Date().toISOString().slice(0, 10)

const persona = {
  id: 'per1', company_id: 'co1', project_id: 'p1', nombre: 'Dina',
  cargo: 'conserje', turno: 'diurno', estado: 'activo', created_at: '',
} as PersonalCondominio

const areas = [
  { id: 'a8', nombre: 'Nivel 8 (Azotea)', icono: '🏢', activo: true },
  { id: 'a7', nombre: 'Nivel 7', icono: '🏬', activo: true },
] as AreaCondominio[]

function bloque(estado: BloqueTurno['estado']): BloqueTurno {
  return {
    id: 'blo1', company_id: 'co1', project_id: 'p1', personal_id: 'per1',
    turno: 'manana', fecha: HOY, estado, foto_urls: [], created_at: '',
  } as unknown as BloqueTurno
}

function tarea(id: string, orden: number, over: Partial<TareaBloque> = {}): TareaBloque {
  return {
    id, bloque_id: 'blo1', titulo: `Tarea ${id}`, orden, requiere_foto: false,
    estado: 'pendiente', foto_urls: [], created_at: '', ...over,
  } as TareaBloque
}

/** Pasillo y gradas en la azotea; pasillo en el 7. */
const recorrido = () => [
  tarea('t1', 0, { titulo: 'Barrido de piso en pasillo', area_id: 'a8', plantilla_id: 'barrer', duracion_estimada_min: 5 }),
  tarea('t2', 1, { titulo: 'Barrido de gradas', area_id: 'a8', plantilla_id: 'barrer', duracion_estimada_min: 3 }),
  tarea('t3', 2, {
    titulo: 'Pasillo del 7', area_id: 'a7', plantilla_id: 'vidrios', requiere_foto: true,
    instrucciones_seguridad: 'Usar rótulo de área en mantenimiento',
  }),
]

function montar(estado: BloqueTurno['estado'], tareas: TareaBloque[]) {
  const r = render(
    <TareasPersonalTab
      bloques={[bloque(estado)]}
      tareas={tareas}
      plantillas={[] as PlantillaTareaCargo[]}
      personal={[persona]}
      areas={areas}
      proyectoId="p1"
      companyId="co1"
      userId="u1"
      canCreate
      canEdit
      canDelete
      onRefresh={() => {}}
    />,
  )
  return r
}

const abrir = () => fireEvent.click(screen.getByText('▾'))
const listo = () => fireEvent.click(screen.getByText('✓ Listo · Siguiente ›'))
const tarjeta = () => screen.getByRole('region', { name: /^Tarea \d+ de \d+:/ })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.cerrarTareaYConsumir.mockResolvedValue({ data: { consumidos: 0, no_usados: 0, sin_stock: [] }, error: null })
  mocks.fetchInsumosDeTareas.mockResolvedValue({ insumos: [], error: null })
  mocks.fetchHerramientasDelTurno.mockResolvedValue({ herramientas: [], error: null })
  mocks.confirm.mockResolvedValue({ isConfirmed: true })
})
afterEach(cleanup)

describe('antes de iniciar: lo que hay que tener a mano', () => {
  beforeEach(() => {
    mocks.fetchHerramientasDelTurno.mockResolvedValue({
      herramientas: [
        { plantilla_tarea_id: 'barrer', equipo_id: 'escoba', inventario_id: null, nombre: 'Escoba', estado: 'operativo', cantidad: 1, obligatoria: true },
      ],
      error: null,
    })
    mocks.fetchInsumosDeTareas.mockResolvedValue({
      insumos: [{ id: 'i1', tarea_id: 't3', suministro_id: 'alc', nombre_suministro: 'Alcohol etílico 70%', cantidad_planificada: 1, unidad_medida: 'litro' }],
      error: null,
    })
  })

  it('«▶ Iniciar» no arranca el turno: muestra la preparación sacada de las tareas', async () => {
    montar('pendiente', recorrido())
    fireEvent.click(screen.getByText('▶ Iniciar'))

    const prep = await screen.findByRole('region', { name: 'Antes de iniciar el turno' })
    await within(prep).findByText('Escoba')
    // Por el turno (RPC herramientas_del_turno), no por la lista de actividades.
    expect(mocks.fetchHerramientasDelTurno).toHaveBeenCalledWith('blo1')
    expect(within(prep).getByText('Obligatoria')).toBeTruthy()
    expect(within(prep).getByText('Alcohol etílico 70% — 1 litro')).toBeTruthy()
    expect(within(prep).getByText('Usar rótulo de área en mantenimiento')).toBeTruthy()
    expect(within(prep).getByText('Teléfono con cámara y batería')).toBeTruthy()
    expect(prep.textContent).toMatch(/3 tareas.*2 áreas/)
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('se inicia sólo después de confirmar cada cosa', async () => {
    montar('pendiente', recorrido())
    fireEvent.click(screen.getByText('▶ Iniciar'))
    const prep = await screen.findByRole('region', { name: 'Antes de iniciar el turno' })
    await within(prep).findByText('Escoba')

    const boton = within(prep).getByText('Falta confirmar 4') as HTMLButtonElement
    expect(boton.disabled).toBe(true)
    within(prep).getAllByRole('checkbox').forEach(c => fireEvent.click(c))
    fireEvent.click(within(prep).getByText('✓ Tengo todo · Iniciar turno'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, id, patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect([tabla, id, patch.estado]).toEqual(['bloques_turno', 'blo1', 'en_curso'])
    // Sin esperar la recarga, ya está en curso y en el paso a paso: no hay un segundo «Iniciar».
    expect(await screen.findByRole('region', { name: /^Parada 1 de 2/ })).toBeTruthy()
    expect(screen.queryByText('▶ Iniciar')).toBeNull()
  })

  it('«Todavía no» vuelve sin iniciar', async () => {
    montar('pendiente', recorrido())
    fireEvent.click(screen.getByText('▶ Iniciar'))
    fireEvent.click(await screen.findByText('Todavía no'))
    expect(screen.queryByRole('region', { name: 'Antes de iniciar el turno' })).toBeNull()
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('si no pudo leer las herramientas lo dice, y no esconde el resto', async () => {
    mocks.fetchHerramientasDelTurno.mockResolvedValue({ herramientas: [], error: { message: 'permiso denegado' } })
    montar('pendiente', recorrido())
    fireEvent.click(screen.getByText('▶ Iniciar'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/permiso denegado/)
    expect(screen.getByText('Alcohol etílico 70% — 1 litro')).toBeTruthy()
  })

  it('un turno sin actividades no pide herramientas: no se consulta', async () => {
    montar('pendiente', [tarea('t1', 0)])
    fireEvent.click(screen.getByText('▶ Iniciar'))
    await screen.findByText('✓ Tengo todo · Iniciar turno')
    expect(mocks.fetchHerramientasDelTurno).not.toHaveBeenCalled()
  })

  it('si la base no deja iniciar, lo avisa y la preparación sigue ahí', async () => {
    mocks.fetchInsumosDeTareas.mockResolvedValue({ insumos: [], error: null })
    mocks.fetchHerramientasDelTurno.mockResolvedValue({ herramientas: [], error: null })
    mocks.updateCondominioRow.mockResolvedValue({ error: { message: 'RLS' } })
    montar('pendiente', [tarea('t1', 0)])
    fireEvent.click(screen.getByText('▶ Iniciar'))
    fireEvent.click(await screen.findByText('✓ Tengo todo · Iniciar turno'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    const [args] = mocks.notify.mock.calls[0] as unknown as [{ title: string }]
    expect(args.title).toBe('No se pudo iniciar el turno')
    expect(screen.getByRole('region', { name: 'Antes de iniciar el turno' })).toBeTruthy()
  })
})

describe('en curso: una tarjeta por vez, por paradas', () => {
  it('abre en la primera parada con lo que se hace en ella, y después la primera tarea', () => {
    montar('en_curso', recorrido())
    abrir()
    const intro = screen.getByRole('region', { name: 'Parada 1 de 2: Nivel 8 (Azotea)' })
    expect(intro.textContent).toMatch(/Primera parada/)
    expect(within(intro).getByText(/Barrido de piso en pasillo/)).toBeTruthy()
    expect(within(intro).getByText(/Barrido de gradas/)).toBeTruthy()
    expect(within(intro).queryByText(/Pasillo del 7/)).toBeNull()

    fireEvent.click(screen.getByText('Empezar en Nivel 8 (Azotea) ›'))
    expect(tarjeta().getAttribute('aria-label')).toBe('Tarea 1 de 3: Barrido de piso en pasillo')
    expect(tarjeta().textContent).toMatch(/Tarea 1 de 2 en esta área/)
  })

  it('«Listo · Siguiente» cierra por la RPC y avanza; al cambiar de área, presenta la parada', async () => {
    montar('en_curso', recorrido())
    abrir()
    fireEvent.click(screen.getByText('Empezar en Nivel 8 (Azotea) ›'))

    listo()
    await waitFor(() => expect(tarjeta().getAttribute('aria-label')).toBe('Tarea 2 de 3: Barrido de gradas'))
    expect(mocks.cerrarTareaYConsumir).toHaveBeenCalledWith('t1', [], undefined)
    expect(screen.getByText(/«Barrido de piso en pasillo» guardada ✓\. Sigue: Barrido de gradas\./)).toBeTruthy()

    listo()
    const intro = await screen.findByRole('region', { name: 'Parada 2 de 2: Nivel 7' })
    expect(intro.textContent).toMatch(/Pasillo del 7/)
    fireEvent.click(screen.getByText('Empezar en Nivel 7 ›'))
    // Las indicaciones de la tarea, en la tarjeta y ANTES de los botones.
    expect(within(tarjeta()).getByRole('note').textContent).toMatch(/Usar rótulo/)
  })

  it('sin la evidencia exigida no guarda ni avanza', async () => {
    montar('en_curso', [tarea('t1', 0, { titulo: 'Con foto', requiere_foto: true }), tarea('t2', 1)])
    abrir()
    fireEvent.click(screen.getByText(/^Empezar en /))
    listo()

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    const [args] = mocks.notify.mock.calls[0] as unknown as [{ title: string }]
    expect(args.title).toBe('Falta evidencia')
    expect(mocks.cerrarTareaYConsumir).not.toHaveBeenCalled()
    expect(tarjeta().getAttribute('aria-label')).toBe('Tarea 1 de 2: Con foto')
  })

  it('el comentario recién escrito se guarda ANTES del cierre', async () => {
    montar('en_curso', [tarea('t1', 0, { titulo: 'Con comentario', requiere_comentario: true })])
    abrir()
    fireEvent.click(screen.getByText(/^Empezar en /))
    fireEvent.change(screen.getByLabelText('Comentario de quien ejecuta'), { target: { value: 'Todo en orden' } })
    listo()

    await waitFor(() => expect(mocks.cerrarTareaYConsumir).toHaveBeenCalled())
    const [tabla, id, patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect([tabla, id, patch]).toEqual(['tareas_bloque', 't1', { evidencia_texto: 'Todo en orden' }])
    expect(mocks.updateCondominioRow.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.cerrarTareaYConsumir.mock.invocationCallOrder[0])
  })

  it('dos pasos marcados seguidos no se pisan', async () => {
    montar('en_curso', [tarea('t1', 0, { requiere_checklist: true, checklist: ['Barrer', 'Trapear'], checklist_completado: [] })])
    abrir()
    fireEvent.click(screen.getByText(/^Empezar en /))
    fireEvent.click(screen.getByLabelText('Barrer'))
    fireEvent.click(screen.getByLabelText('Trapear'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(2))
    const [, , segundo] = mocks.updateCondominioRow.mock.calls[1] as unknown as [string, string, Record<string, unknown>]
    expect(segundo.checklist_completado).toEqual([0, 1])
  })

  it('omitir pregunta; si se confirma, queda omitida y avanza', async () => {
    montar('en_curso', [tarea('t1', 0), tarea('t2', 1)])
    abrir()
    fireEvent.click(screen.getByText(/^Empezar en /))

    mocks.confirm.mockResolvedValueOnce({ isConfirmed: false })
    fireEvent.click(screen.getByText('⏭ Omitir'))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('⏭ Omitir'))
    await waitFor(() => expect(tarjeta().getAttribute('aria-label')).toBe('Tarea 2 de 2: Tarea t2'))
    const [, id, patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect([id, patch.estado]).toEqual(['t1', 'omitida'])
  })

  it('«Encontré algo» registra la novedad y avanza; si se cancela, se queda', async () => {
    montar('en_curso', [tarea('t1', 0), tarea('t2', 1)])
    abrir()
    fireEvent.click(screen.getByText(/^Empezar en /))

    fireEvent.click(screen.getByText('⚠️ Encontré algo'))
    await waitFor(() => expect(mocks.openPromptDialog).toHaveBeenCalledTimes(1))
    expect(tarjeta().getAttribute('aria-label')).toBe('Tarea 1 de 2: Tarea t1')

    mocks.openPromptDialog.mockResolvedValueOnce({ novedad: 'Fuga en el lavamanos', prioridad: 'alta', requiere_mantenimiento: 'true' })
    fireEvent.click(screen.getByText('⚠️ Encontré algo'))
    await waitFor(() => expect(tarjeta().getAttribute('aria-label')).toBe('Tarea 2 de 2: Tarea t2'))
    const [, , patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(patch).toMatchObject({ estado: 'con_observacion', novedad: 'Fuga en el lavamanos', requiere_mantenimiento: true })
  })

  it('al terminar, el resumen ofrece cerrar el turno', async () => {
    montar('en_curso', [tarea('t1', 0), tarea('t2', 1, { estado: 'completada' })])
    abrir()
    fireEvent.click(screen.getByText(/^Empezar en /))
    listo()

    const fin = await screen.findByRole('region', { name: 'Recorrido terminado' })
    expect(fin.textContent).toMatch(/¡Recorrido terminado!/)
    expect(fin.textContent).toMatch(/2 hechas/)
    fireEvent.click(within(fin).getByText('✓ Cerrar turno'))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalled())
    const [tabla, , patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    // 100 y no 50: la tarea recién cerrada cuenta aunque la recarga no haya vuelto.
    expect([tabla, patch.estado, patch.puntaje_completitud]).toEqual(['bloques_turno', 'completado', 100])
    // Y por lo mismo no pregunta: la que estaba pendiente ya se resolvió aquí.
    expect(mocks.confirm).not.toHaveBeenCalled()
    // Y el turno ya se ve cerrado: no queda un segundo «Cerrar turno» para volver a escribir.
    await waitFor(() => expect(screen.queryByText('✓ Cerrar turno')).toBeNull())
  })

  // 20261226000100: el paso opcional de la rutina llega a la tarea.
  it('la tarjeta dice «Opcional» cuando la tarea lo es, y sólo entonces', async () => {
    montar('en_curso', [tarea('t1', 0), tarea('t2', 1, { obligatoria: false })])
    abrir()
    // La parada anuncia cuál de sus tareas es opcional antes de empezar.
    expect(screen.getAllByText('Opcional')).toHaveLength(1)
    fireEvent.click(screen.getByText(/^Empezar en /))
    expect(tarjeta().getAttribute('aria-label')).toBe('Tarea 1 de 2: Tarea t1')
    expect(within(tarjeta()).queryByText('Opcional')).toBeNull()

    listo()
    await waitFor(() => expect(tarjeta().getAttribute('aria-label')).toBe('Tarea 2 de 2: Tarea t2'))
    const chip = within(tarjeta()).getByText('Opcional')
    expect(chip.getAttribute('title')).toMatch(/no queda pendiente ni baja el puntaje/)
  })

  it('al cerrar, la opcional sin hacer no baja el puntaje', async () => {
    montar('en_curso', [tarea('t1', 0), tarea('t2', 1, { obligatoria: false, estado: 'omitida' })])
    abrir()
    fireEvent.click(screen.getByText(/^Empezar en /))
    listo()

    const fin = await screen.findByRole('region', { name: 'Recorrido terminado' })
    fireEvent.click(within(fin).getByText('✓ Cerrar turno'))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalled())
    const [tabla, , patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    // 100 y no 50: suma si se hace, no resta si no.
    expect([tabla, patch.puntaje_completitud]).toEqual(['bloques_turno', 100])
  })

  it('«Anterior» deja ver lo ya hecho, sin acciones de ejecutar', async () => {
    montar('en_curso', [tarea('t1', 0, { estado: 'completada' }), tarea('t2', 1)])
    abrir()
    fireEvent.click(screen.getByText(/^Empezar en /))
    expect(tarjeta().getAttribute('aria-label')).toBe('Tarea 2 de 2: Tarea t2')

    fireEvent.click(screen.getByLabelText('Tarea anterior'))
    expect(tarjeta().getAttribute('aria-label')).toBe('Tarea 1 de 2: Tarea t1')
    expect(tarjeta().textContent).toMatch(/✅ Hecha/)
    expect(screen.queryByText('✓ Listo · Siguiente ›')).toBeNull()
  })

  it('el recorrido marca la parada actual y lleva a otra', () => {
    montar('en_curso', recorrido())
    abrir()
    const nav = screen.getByRole('navigation', { name: 'Recorrido por áreas' })
    expect(within(nav).getByLabelText('Ir a Nivel 8 (Azotea): 0 de 2 resueltas').getAttribute('aria-current')).toBe('step')
    fireEvent.click(within(nav).getByLabelText('Ir a Nivel 7: 0 de 1 resueltas'))
    expect(screen.getByRole('region', { name: 'Parada 2 de 2: Nivel 7' })).toBeTruthy()
  })

  it('se puede pasar a la lista completa y volver', () => {
    montar('en_curso', recorrido())
    abrir()
    fireEvent.click(screen.getByText('☰ Ver lista completa'))
    expect(screen.getAllByTitle('Completada')).toHaveLength(3)
    fireEvent.click(screen.getByText('▶ Volver al paso a paso'))
    expect(screen.getByRole('region', { name: /^Parada 1 de 2/ })).toBeTruthy()
  })
})

describe('pasos marcados con la red lenta', () => {
  type Patch = Record<string, unknown>
  const escritos = () => mocks.updateCondominioRow.mock.calls
    .map(c => (c as unknown as [string, string, Patch])[2].checklist_completado)
  /** Deja correr lo que esté en camino (promesas encadenadas, renders). */
  const unRato = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

  /**
   * Cada PATCH queda colgado hasta que el test lo responde, y la base lo
   * escribe al responderlo: el orden de las respuestas es el orden en que
   * quedó escrito. `fallan` son los números de llamada (desde 0) que la base
   * rechaza sin escribir.
   */
  function redLenta(fallan: number[] = []) {
    const fila: { checklist_completado?: number[] } = {}
    const colgados: Array<() => void> = []
    let llamada = 0
    mocks.updateCondominioRow.mockImplementation((...args: unknown[]) => {
      const falla = fallan.includes(llamada++)
      return new Promise(resolve => colgados.push(() => {
        if (falla) { resolve({ error: { message: 'se cortó la red' } }); return }
        Object.assign(fila, args[2] as Patch)
        resolve({ error: null })
      }))
    })
    /** Responde lo colgado, lo más nuevo primero, hasta que no salga nada más. */
    const responderEnDesorden = () => act(async () => {
      await new Promise(r => setTimeout(r, 0))
      while (colgados.length > 0) {
        colgados.splice(0).reverse().forEach(responder => responder())
        await new Promise(r => setTimeout(r, 0))
      }
    })
    return { fila, responderEnDesorden }
  }

  const vidrios = (over: Partial<TareaBloque> = {}) => tarea('t1', 0, {
    titulo: 'Limpieza de vidrios', requiere_checklist: true,
    checklist: ['Rociar', 'Pasar el paño', 'Secar'], checklist_completado: [], ...over,
  })
  const marcarLosTres = () => ['Rociar', 'Pasar el paño', 'Secar']
    .forEach(paso => fireEvent.click(screen.getByLabelText(paso)))

  it('tres pasos seguidos: lo último escrito es la lista entera, aunque la red responda al revés', async () => {
    const red = redLenta()
    montar('en_curso', [vidrios()])
    abrir()
    fireEvent.click(screen.getByText(/^Empezar en /))
    marcarLosTres()

    // De a uno: el segundo no sale hasta que responda el primero.
    await unRato()
    expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1)

    await red.responderEnDesorden()
    expect(escritos()).toEqual([[0], [0, 1], [0, 1, 2]])
    expect(red.fila.checklist_completado).toEqual([0, 1, 2])
  })

  it('«Listo» con los guardados todavía en camino cierra igual: la fila ya tiene los tres pasos', async () => {
    const red = redLenta()
    // El trigger `exigir_evidencia_al_cerrar` lee la fila, no la pantalla.
    mocks.cerrarTareaYConsumir.mockImplementation(async () => (red.fila.checklist_completado ?? []).length === 3
      ? { data: { consumidos: 0, no_usados: 0, sin_stock: [] }, error: null }
      : { data: null as never, error: { message: 'EVIDENCIA: la tarea tiene el checklist a medias' } })
    montar('en_curso', [vidrios(), tarea('t2', 1)])
    abrir()
    fireEvent.click(screen.getByText(/^Empezar en /))
    marcarLosTres()
    listo()

    await red.responderEnDesorden()
    await waitFor(() => expect(tarjeta().getAttribute('aria-label')).toBe('Tarea 2 de 2: Tarea t2'))
    expect(mocks.cerrarTareaYConsumir).toHaveBeenCalledWith('t1', [], undefined)
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('«Listo» guarda la lista de la pantalla y espera la respuesta antes de cerrar', async () => {
    montar('en_curso', [tarea('t1', 0, { requiere_checklist: true, checklist: ['Barrer', 'Trapear'], checklist_completado: [] })])
    abrir()
    fireEvent.click(screen.getByText(/^Empezar en /))
    fireEvent.click(screen.getByLabelText('Barrer'))
    fireEvent.click(screen.getByLabelText('Trapear'))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(2))

    // La recarga no volvió (`tareas` sigue sin pasos): lo que vale es la pantalla.
    let responder!: () => void
    mocks.updateCondominioRow.mockImplementationOnce(() => new Promise(r => { responder = () => r({ error: null }) }))
    listo()
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(3))
    expect(mocks.updateCondominioRow.mock.calls[2]).toEqual(['tareas_bloque', 't1', { checklist_completado: [0, 1] }])

    await unRato()
    expect(mocks.cerrarTareaYConsumir).not.toHaveBeenCalled()
    await act(async () => { responder() })
    await waitFor(() => expect(mocks.cerrarTareaYConsumir).toHaveBeenCalledWith('t1', [], undefined))
  })

  it('si no se pudieron guardar los pasos, no intenta cerrar y se queda en la tarea', async () => {
    montar('en_curso', [tarea('t1', 0, { requiere_checklist: true, checklist: ['Barrer'], checklist_completado: [] }), tarea('t2', 1)])
    abrir()
    fireEvent.click(screen.getByText(/^Empezar en /))
    fireEvent.click(screen.getByLabelText('Barrer'))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))

    mocks.updateCondominioRow.mockResolvedValueOnce({ error: { message: 'se cortó la red' } })
    listo()
    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    const [args] = mocks.notify.mock.calls[0] as unknown as [{ title: string; text: string }]
    expect(args.text).toBe('se cortó la red')
    expect(mocks.cerrarTareaYConsumir).not.toHaveBeenCalled()
    expect(tarjeta().getAttribute('aria-label')).toBe('Tarea 1 de 2: Tarea t1')
    // Lo marcado sigue a la vista: el próximo «Listo» lo vuelve a mandar.
    expect((screen.getByLabelText('Barrer') as HTMLInputElement).checked).toBe(true)
  })

  it('un guardado que falla y ya quedó detrás de otro no avisa ni desmarca', async () => {
    const red = redLenta([0])
    montar('en_curso', [vidrios()])
    abrir()
    fireEvent.click(screen.getByText(/^Empezar en /))
    fireEvent.click(screen.getByLabelText('Rociar'))
    fireEvent.click(screen.getByLabelText('Pasar el paño'))

    await red.responderEnDesorden()
    expect(red.fila.checklist_completado).toEqual([0, 1])
    expect(mocks.notify).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Rociar') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Pasar el paño') as HTMLInputElement).checked).toBe(true)
  })

  it('si falla el último guardado, avisa y la pantalla vuelve a lo de la fila', async () => {
    const red = redLenta([1])
    montar('en_curso', [vidrios()])
    abrir()
    fireEvent.click(screen.getByText(/^Empezar en /))
    fireEvent.click(screen.getByLabelText('Rociar'))
    fireEvent.click(screen.getByLabelText('Pasar el paño'))

    await red.responderEnDesorden()
    expect(mocks.notify).toHaveBeenCalledTimes(1)
    expect((screen.getByLabelText('Pasar el paño') as HTMLInputElement).checked).toBe(false)
  })
})

describe('cerrar el turno', () => {
  const cerrarDesdeEncabezado = () => fireEvent.click(screen.getByText('✓ Cerrar turno'))
  const cierreDelTurno = () => mocks.updateCondominioRow.mock.calls
    .filter(c => (c as unknown as [string])[0] === 'bloques_turno')

  it('con tareas pendientes pide confirmar, diciendo cuántas y que pasan a atrasadas', async () => {
    mocks.confirm.mockResolvedValueOnce({ isConfirmed: false })
    montar('en_curso', [tarea('t1', 0), tarea('t2', 1), tarea('t3', 2, { estado: 'completada' })])
    cerrarDesdeEncabezado()

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))
    const [opts] = mocks.confirm.mock.calls[0] as unknown as [{ title: string; text: string }]
    expect(opts.text).toMatch(/Quedan 2 tareas pendientes/)
    expect(opts.text).toMatch(/atrasadas/)
    // Cancelar no cierra: el turno sigue en curso.
    expect(cierreDelTurno()).toHaveLength(0)
    expect(screen.getByText('✓ Cerrar turno')).toBeTruthy()
  })

  it('con tareas pendientes, si se confirma, cierra con el puntaje de lo hecho', async () => {
    montar('en_curso', [tarea('t1', 0), tarea('t2', 1, { estado: 'completada' })])
    cerrarDesdeEncabezado()

    await waitFor(() => expect(cierreDelTurno()).toHaveLength(1))
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    const [opts] = mocks.confirm.mock.calls[0] as unknown as [{ text: string }]
    expect(opts.text).toMatch(/Queda 1 tarea pendiente/)
    const [, id, patch] = cierreDelTurno()[0] as unknown as [string, string, Record<string, unknown>]
    expect([id, patch.estado, patch.puntaje_completitud]).toEqual(['blo1', 'completado', 50])
  })

  // La base sólo guarda «completado» al cerrar: con obligatorias sin hacer, la tarjeta dice «Incompleto».
  it('cerrado con pendientes confirmadas, la tarjeta dice Incompleto y no Completado', async () => {
    montar('en_curso', [tarea('t1', 0), tarea('t2', 1)])
    cerrarDesdeEncabezado()

    await waitFor(() => expect(cierreDelTurno()).toHaveLength(1))
    expect(await screen.findByText('Incompleto')).toBeTruthy()
    expect(screen.queryByText('Completado')).toBeNull()
  })

  it('un turno ya cerrado se lee por lo que quedó: Incompleto con obligatorias pendientes, Completado si no', () => {
    const { unmount } = montar('completado', [tarea('t1', 0), tarea('t2', 1, { estado: 'completada' })])
    expect(screen.getByText('Incompleto')).toBeTruthy()
    unmount()
    montar('completado', [tarea('t1', 0, { estado: 'completada' }), tarea('t2', 1, { estado: 'omitida' }), tarea('t3', 2, { obligatoria: false })])
    expect(screen.getByText('Completado')).toBeTruthy()
    expect(screen.queryByText('Incompleto')).toBeNull()
  })

  it('sin pendientes cierra de un toque, sin preguntar', async () => {
    montar('en_curso', [
      tarea('t1', 0, { estado: 'completada' }),
      tarea('t2', 1, { estado: 'con_observacion' }),
      tarea('t3', 2, { estado: 'omitida' }),
    ])
    cerrarDesdeEncabezado()

    await waitFor(() => expect(cierreDelTurno()).toHaveLength(1))
    expect(mocks.confirm).not.toHaveBeenCalled()
    const [, , patch] = cierreDelTurno()[0] as unknown as [string, string, Record<string, unknown>]
    expect(patch.estado).toBe('completado')
    await waitFor(() => expect(screen.queryByText('✓ Cerrar turno')).toBeNull())
  })

  // 20261226000100: la opcional sin hacer no pasa a atrasadas ni baja el puntaje.
  it('si sólo quedan opcionales, cierra sin preguntar y con el puntaje entero', async () => {
    montar('en_curso', [
      tarea('t1', 0, { estado: 'completada' }),
      tarea('t2', 1, { obligatoria: false }),
    ])
    cerrarDesdeEncabezado()

    await waitFor(() => expect(cierreDelTurno()).toHaveLength(1))
    expect(mocks.confirm).not.toHaveBeenCalled()
    const [, , patch] = cierreDelTurno()[0] as unknown as [string, string, Record<string, unknown>]
    expect([patch.estado, patch.puntaje_completitud]).toEqual(['completado', 100])
  })

  it('la pregunta cuenta sólo las obligatorias pendientes', async () => {
    mocks.confirm.mockResolvedValueOnce({ isConfirmed: false })
    montar('en_curso', [tarea('t1', 0), tarea('t2', 1, { obligatoria: false }), tarea('t3', 2, { obligatoria: false })])
    cerrarDesdeEncabezado()

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))
    const [opts] = mocks.confirm.mock.calls[0] as unknown as [{ text: string }]
    expect(opts.text).toMatch(/Queda 1 tarea pendiente/)
    expect(cierreDelTurno()).toHaveLength(0)
  })

  it('el resumen con tareas sin resolver también pregunta antes de cerrar', async () => {
    mocks.confirm.mockResolvedValueOnce({ isConfirmed: false })
    montar('en_curso', [
      tarea('t1', 0, { area_id: 'a8' }),
      tarea('t2', 1, { area_id: 'a7', estado: 'completada' }),
    ])
    abrir()
    const nav = screen.getByRole('navigation', { name: 'Recorrido por áreas' })
    fireEvent.click(within(nav).getByLabelText(/^Ir a Nivel 7/))
    // El área ya está hecha: se ve su tarea, sin acciones, y desde ahí el resumen.
    fireEvent.click(screen.getByText('Ver resumen ›'))

    const fin = screen.getByRole('region', { name: 'Recorrido terminado' })
    expect(fin.textContent).toMatch(/Quedan tareas sin resolver/)
    fireEvent.click(within(fin).getByText('✓ Cerrar turno'))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))
    expect(cierreDelTurno()).toHaveLength(0)
  })
})
