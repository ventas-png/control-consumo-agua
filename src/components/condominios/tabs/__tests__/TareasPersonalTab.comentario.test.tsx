// El comentario de quien ejecuta, con la red lenta.
//
// Se guarda al salir del campo, y «Listo» lo vuelve a escribir antes del
// cierre porque el trigger lee la fila, no la pantalla. Lo que se cubre: que
// esos guardados salgan en orden (uno viejo no pisa al texto completo), que
// salir sin cambiar nada no mande nada, que «Listo» espere lo que esté en
// camino y que un guardado fallido se avise.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
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

const banos = (over: Partial<TareaBloque> = {}) =>
  tarea('t1', 0, { titulo: 'Baños del lobby', requiere_comentario: true, ...over })

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
const campo = () => screen.getByLabelText('Comentario de quien ejecuta') as HTMLTextAreaElement
/** Entra al campo, deja `texto` y sale, como al tocar otra cosa de la tarjeta. */
function escribir(texto: string) {
  fireEvent.focus(campo())
  fireEvent.change(campo(), { target: { value: texto } })
  fireEvent.blur(campo())
}
/** Entra y sale sin tocar el texto. */
function entrarYSalir() {
  fireEvent.focus(campo())
  fireEvent.blur(campo())
}
const listo = () => fireEvent.click(screen.getByText('✓ Listo · Siguiente ›'))
const tarjeta = () => screen.getByRole('region', { name: /^Tarea \d+ de \d+:/ })
const escritos = () => mocks.updateCondominioRow.mock.calls.map(c => (c as unknown as [string, string, Patch])[2].evidencia_texto)
const titulosAvisos = () => mocks.notify.mock.calls.map(c => (c as unknown as [{ title: string }])[0].title)
/** Deja correr lo que esté en camino (promesas encadenadas, renders). */
const unRato = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

/**
 * Cada PATCH queda colgado hasta que el test lo responde, y la base lo escribe
 * al responderlo: el orden de las respuestas es el orden en que quedó escrito.
 * `fila` arranca como la tarea que se monta.
 */
function redLenta(fila: Patch = {}) {
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

/**
 * El trigger `exigir_evidencia_al_cerrar` sobre la fila de `redLenta`.
 * Devuelve el comentario que tenía la fila en cada intento de cierre.
 */
function triggerDeEvidencia(fila: Patch) {
  const alCerrar: unknown[] = []
  mocks.cerrarTareaYConsumir.mockImplementation(async () => {
    alCerrar.push(fila.evidencia_texto)
    return String(fila.evidencia_texto ?? '').trim() !== ''
      ? { data: { consumidos: 0, no_usados: 0, sin_stock: [] }, error: null }
      : { data: null as never, error: { message: 'EVIDENCIA: la tarea "Baños del lobby" exige un comentario' } }
  })
  return alCerrar
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.cerrarTareaYConsumir.mockResolvedValue({ data: { consumidos: 0, no_usados: 0, sin_stock: [] }, error: null })
  mocks.fetchInsumosDeTareas.mockResolvedValue({ insumos: [], error: null })
  mocks.fetchHerramientasDePlantillas.mockResolvedValue({ herramientas: [], error: null })
})
afterEach(cleanup)

describe('comentario de evidencia con la red lenta', () => {
  it('escribir, salir, seguir escribiendo y «Listo»: queda el texto completo, aunque la red responda al revés', async () => {
    const red = redLenta()
    const alCerrar = triggerDeEvidencia(red.fila)
    montarGuiado([banos(), tarea('t2', 1)])
    escribir('Todo bien')
    escribir('Todo bien, falta jabón')

    // De a uno: el segundo no sale hasta que responda el primero.
    await unRato()
    expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1)

    listo()
    await red.responderEnDesorden()
    await waitFor(() => expect(tarjeta().getAttribute('aria-label')).toBe('Tarea 2 de 2: Tarea t2'))
    // Sin la cola, el «Todo bien» del primer blur llegaba último: cerraba igual,
    // sin aviso, con el comentario cortado.
    expect(alCerrar).toEqual(['Todo bien, falta jabón'])
    expect(red.fila.evidencia_texto).toBe('Todo bien, falta jabón')
    expect(titulosAvisos()).toEqual([])
  })

  it('entrar y salir sin escribir no manda nada, y salir dos veces con el mismo texto lo manda una', async () => {
    montarGuiado([banos()])
    entrarYSalir()
    await unRato()
    // Antes salía un `evidencia_texto: ''` que, si llegaba último, rechazaba el cierre.
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()

    escribir('Todo en orden')
    entrarYSalir()
    await unRato()
    expect(escritos()).toEqual(['Todo en orden'])
  })

  it('volver al texto que ya tenía la fila: «Listo» lo escribe igual y espera lo que está en camino', async () => {
    const red = redLenta({ evidencia_texto: 'Sin novedad' })
    const alCerrar = triggerDeEvidencia(red.fila)
    montarGuiado([banos({ evidencia_texto: 'Sin novedad' })])
    escribir('Falta jabón')
    escribir('Sin novedad')
    listo()

    // Antes, con el texto igual al de `tareas`, cerraba sin escribir ni esperar.
    await unRato()
    expect(mocks.cerrarTareaYConsumir).not.toHaveBeenCalled()

    await red.responderEnDesorden()
    await waitFor(() => expect(mocks.cerrarTareaYConsumir).toHaveBeenCalled())
    expect(escritos()).toEqual(['Falta jabón', 'Sin novedad', 'Sin novedad'])
    expect(alCerrar).toEqual(['Sin novedad'])
    expect(red.fila.evidencia_texto).toBe('Sin novedad')
  })

  it('si falla el guardado al salir, avisa, el texto sigue y salir de nuevo lo reintenta', async () => {
    mocks.updateCondominioRow.mockResolvedValueOnce({ error: { message: 'se cortó la red' } })
    montarGuiado([banos()])
    escribir('Todo bien')

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    expect(titulosAvisos()).toEqual(['No se guardó el comentario'])
    expect(campo().value).toBe('Todo bien')

    entrarYSalir()
    await unRato()
    expect(escritos()).toEqual(['Todo bien', 'Todo bien'])
  })

  it('si no se pudo guardar el comentario al tocar «Listo», no intenta cerrar', async () => {
    montarGuiado([banos(), tarea('t2', 1)])
    fireEvent.change(campo(), { target: { value: 'Todo bien' } })
    mocks.updateCondominioRow.mockResolvedValueOnce({ error: { message: 'se cortó la red' } })
    listo()

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    expect(mocks.cerrarTareaYConsumir).not.toHaveBeenCalled()
    expect(tarjeta().getAttribute('aria-label')).toBe('Tarea 1 de 2: Baños del lobby')
    expect(campo().value).toBe('Todo bien')
  })
})
