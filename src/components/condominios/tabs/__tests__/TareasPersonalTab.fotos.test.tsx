// Las fotos de evidencia de una tarea, con la red lenta.
//
// Cada cambio en el uploader manda la lista ENTERA a `foto_urls`, como los
// pasos. Lo que se cubre: que los guardados salgan en orden, que «Listo»
// escriba lo que se ve antes del cierre (el trigger lee la fila, no la
// pantalla) y que no se cierre a mitad de una subida. El uploader real está en
// shared/ImageUploader; aquí lo reemplaza uno que deja disparar lo que haría.
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
  fetchHerramientasDePlantillas: vi.fn(async () => ({
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
  fetchHerramientasDePlantillas: mocks.fetchHerramientasDePlantillas,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: mocks.openPromptDialog }))

/**
 * Hace lo que el uploader real: arma la lista con la vigente y avisa cuándo
 * empieza y termina una subida (`onSubiendo`).
 */
vi.mock('../../../shared/ImageUploader', () => ({
  ImageUploader: () => null,
  MultiImageUploader: ({ values, onChange, onSubiendo }: {
    values: string[]; onChange: (urls: string[]) => void; onSubiendo?: (s: boolean) => void
  }) => (
    <div>
      <button onClick={() => onChange([...values, 'b.jpg'])}>agregar b.jpg</button>
      <button onClick={() => onChange(values.filter(u => u !== 'a.jpg'))}>quitar a.jpg</button>
      <button onClick={() => onSubiendo?.(true)}>empezar a subir c.jpg</button>
      <button onClick={() => { onChange([...values, 'c.jpg']); onSubiendo?.(false) }}>terminar de subir c.jpg</button>
      <span data-testid="fotos">{values.join(',')}</span>
    </div>
  ),
}))

const { TareasPersonalTab } = await import('../TareasPersonalTab')

// ── Datos ──────────────────────────────────────────────────────────────────

const HOY = new Date().toISOString().slice(0, 10)

const persona = {
  id: 'per1', company_id: 'co1', project_id: 'p1', nombre: 'Dina',
  cargo: 'conserje', turno: 'diurno', estado: 'activo', created_at: '',
} as PersonalCondominio

const bloque = {
  id: 'blo1', company_id: 'co1', project_id: 'p1', personal_id: 'per1',
  turno: 'manana', fecha: HOY, estado: 'en_curso', foto_urls: [], created_at: '',
} as unknown as BloqueTurno

function tarea(id: string, orden: number, over: Partial<TareaBloque> = {}): TareaBloque {
  return {
    id, bloque_id: 'blo1', titulo: `Tarea ${id}`, orden, requiere_foto: false,
    estado: 'pendiente', foto_urls: [], created_at: '', ...over,
  } as TareaBloque
}

const vidrios = (over: Partial<TareaBloque> = {}) =>
  tarea('t1', 0, { titulo: 'Limpieza de vidrios', requiere_foto: true, ...over })

/** Monta el turno en curso y entra a la primera tarea del paso a paso. */
function montarGuiado(tareas: TareaBloque[]) {
  render(
    <TareasPersonalTab
      bloques={[bloque]}
      tareas={tareas}
      plantillas={[] as PlantillaTareaCargo[]}
      personal={[persona]}
      areas={[] as AreaCondominio[]}
      proyectoId="p1"
      companyId="co1"
      userId="u1"
      canCreate
      canEdit
      canDelete
      // Sin recarga: `tareas` sigue con la fila vieja, como con la red lenta.
      onRefresh={() => {}}
    />,
  )
  fireEvent.click(screen.getByText('▾'))
  fireEvent.click(screen.getByText(/^Empezar en /))
}

type Patch = Record<string, unknown>
const tarjeta = () => screen.getByRole('region', { name: /^Tarea \d+ de \d+:/ })
const botonListo = () => within(tarjeta()).getByText(/Listo · Siguiente|Subiendo foto…|Guardando…/).closest('button') as HTMLButtonElement
const patches = () => mocks.updateCondominioRow.mock.calls.map(c => (c as unknown as [string, string, Patch])[2])
const titulosAvisos = () => mocks.notify.mock.calls.map(c => (c as unknown as [{ title: string }])[0].title)
/** Deja correr lo que esté en camino (promesas encadenadas, renders). */
const unRato = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

/**
 * Cada PATCH queda colgado hasta que el test lo responde, y la base lo escribe
 * al responderlo: el orden de las respuestas es el orden en que quedó escrito.
 */
function redLenta() {
  const fila: Patch = {}
  const colgados: Array<() => void> = []
  mocks.updateCondominioRow.mockImplementation((...args: unknown[]) => new Promise(resolve => {
    colgados.push(() => { Object.assign(fila, args[2] as Patch); resolve({ error: null }) })
  }))
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

/** El trigger `exigir_evidencia_al_cerrar`, sobre la fila de `redLenta`. */
function triggerDeEvidencia(fila: Patch) {
  mocks.cerrarTareaYConsumir.mockImplementation(async () => ((fila.foto_urls as string[] | undefined) ?? []).length > 0
    ? { data: { consumidos: 0, no_usados: 0, sin_stock: [] }, error: null }
    : { data: null as never, error: { message: 'EVIDENCIA: la tarea "Limpieza de vidrios" exige foto y no tiene ninguna' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.cerrarTareaYConsumir.mockResolvedValue({ data: { consumidos: 0, no_usados: 0, sin_stock: [] }, error: null })
  mocks.fetchInsumosDeTareas.mockResolvedValue({ insumos: [], error: null })
  mocks.fetchHerramientasDePlantillas.mockResolvedValue({ herramientas: [], error: null })
})
afterEach(cleanup)

describe('fotos de evidencia con la red lenta', () => {
  it('agregar una y quitar otra seguidas: lo último escrito es lo que se ve, aunque la red responda al revés', async () => {
    const red = redLenta()
    montarGuiado([vidrios({ foto_urls: ['a.jpg'] })])
    fireEvent.click(screen.getByText('agregar b.jpg'))
    fireEvent.click(screen.getByText('quitar a.jpg'))

    // De a uno: el segundo no sale hasta que responda el primero.
    await unRato()
    expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1)

    await red.responderEnDesorden()
    expect(patches()).toEqual([{ foto_urls: ['a.jpg', 'b.jpg'] }, { foto_urls: ['b.jpg'] }])
    // Sin la cola quedaba `a.jpg` en la fila, y su archivo ya se había borrado del bucket.
    expect(red.fila.foto_urls).toEqual(['b.jpg'])
    expect(screen.getByTestId('fotos').textContent).toBe('b.jpg')
  })

  it('«Listo» con la foto todavía en camino cierra igual: la fila ya la tiene', async () => {
    const red = redLenta()
    triggerDeEvidencia(red.fila)
    montarGuiado([vidrios(), tarea('t2', 1)])
    fireEvent.click(screen.getByText('agregar b.jpg'))
    fireEvent.click(botonListo())

    await red.responderEnDesorden()
    await waitFor(() => expect(tarjeta().getAttribute('aria-label')).toBe('Tarea 2 de 2: Tarea t2'))
    expect(mocks.cerrarTareaYConsumir).toHaveBeenCalledWith('t1', [], undefined)
    expect(titulosAvisos()).toEqual([])
  })

  it('«Listo» guarda las fotos de la pantalla y espera la respuesta antes de cerrar', async () => {
    montarGuiado([vidrios()])
    fireEvent.click(screen.getByText('agregar b.jpg'))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))

    let responder!: () => void
    mocks.updateCondominioRow.mockImplementationOnce(() => new Promise(r => { responder = () => r({ error: null }) }))
    fireEvent.click(botonListo())
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(2))
    expect(mocks.updateCondominioRow.mock.calls[1]).toEqual(['tareas_bloque', 't1', { foto_urls: ['b.jpg'] }])

    await unRato()
    expect(mocks.cerrarTareaYConsumir).not.toHaveBeenCalled()
    await act(async () => { responder() })
    await waitFor(() => expect(mocks.cerrarTareaYConsumir).toHaveBeenCalledWith('t1', [], undefined))
  })

  it('con pasos y foto, «Listo» escribe las dos listas antes del cierre', async () => {
    montarGuiado([vidrios({ requiere_checklist: true, checklist: ['Rociar'], checklist_completado: [] })])
    fireEvent.click(screen.getByLabelText('Rociar'))
    fireEvent.click(screen.getByText('agregar b.jpg'))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(2))

    fireEvent.click(botonListo())
    await waitFor(() => expect(mocks.cerrarTareaYConsumir).toHaveBeenCalled())
    // Los dos guardados de «Listo» (el 3.º y el 4.º), y los dos antes del cierre.
    expect(patches().slice(2)).toEqual(expect.arrayContaining([{ checklist_completado: [0] }, { foto_urls: ['b.jpg'] }]))
    expect(patches()).toHaveLength(4)
    const cierre = mocks.cerrarTareaYConsumir.mock.invocationCallOrder[0]
    expect(mocks.updateCondominioRow.mock.invocationCallOrder.every(o => o < cierre)).toBe(true)
  })
})

describe('cerrar a mitad de una subida', () => {
  it('«Listo» espera mientras se sube la foto, diciendo por qué, y después cierra con ella', async () => {
    const red = redLenta()
    triggerDeEvidencia(red.fila)
    montarGuiado([vidrios(), tarea('t2', 1)])
    expect(botonListo().disabled).toBe(false)

    fireEvent.click(screen.getByText('empezar a subir c.jpg'))
    expect(botonListo().disabled).toBe(true)
    expect(botonListo().textContent).toBe('Subiendo foto…')

    fireEvent.click(screen.getByText('terminar de subir c.jpg'))
    expect(botonListo().disabled).toBe(false)
    expect(botonListo().textContent).toBe('✓ Listo · Siguiente ›')
    fireEvent.click(botonListo())

    await red.responderEnDesorden()
    await waitFor(() => expect(tarjeta().getAttribute('aria-label')).toBe('Tarea 2 de 2: Tarea t2'))
    expect(red.fila.foto_urls).toEqual(['c.jpg'])
    expect(titulosAvisos()).toEqual([])
  })

  it('en la lista, el ✅ a mitad de una subida avisa y no cierra', async () => {
    montarGuiado([vidrios({ foto_urls: ['a.jpg'] })])
    fireEvent.click(screen.getByText('☰ Ver lista completa'))
    fireEvent.click(screen.getByLabelText('Evidencia de Limpieza de vidrios'))
    fireEvent.click(screen.getByText('empezar a subir c.jpg'))
    // Ya tiene una foto: sin esto se cerraba sin la que estaba subiendo.
    fireEvent.click(screen.getByTitle('Completada'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    expect(titulosAvisos()).toEqual(['Subiendo foto'])
    expect(mocks.cerrarTareaYConsumir).not.toHaveBeenCalled()
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })
})
