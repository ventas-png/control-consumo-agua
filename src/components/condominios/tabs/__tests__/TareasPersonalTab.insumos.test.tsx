// El cierre y el consumo son UNA operación (20260907001000).
//
// EL AGUJERO QUE CIERRA. Antes la pantalla cerraba la tarea con un UPDATE y
// DESPUÉS llamaba a la RPC de consumo: si la segunda fallaba —o la respuesta se
// perdía— la tarea quedaba cerrada con el almacén intacto, y nada volvía a
// intentarlo. Ahora `marcarTarea('completada')` hace UNA llamada a
// `cerrarTareaYConsumir` y la base decide todo junto: evidencia, autorización,
// transición y consumo, o nada.
//
// Lo que se cubre aquí es lo de la VISTA, que el sandbox SQL no puede ver: que
// el cierre por 'completada' sea UNA sola llamada (ningún UPDATE aparte), que
// se ofrezca la cantidad planificada pero se mande la DECLARADA, que `0` se
// mande como 0 y no se omita, que la fila ya descontada o sellada como «no
// usada» no se re-ofrezca ni se re-mande, que el motivo declarado viaje a la
// RPC, y que la falta de existencias se avise como advertencia y no como error
// —el insumo se gastó igual y la tarea ya cerró.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type {
  AreaCondominio, BloqueTurno, PersonalCondominio, PlantillaTareaCargo,
  TareaBloque, TareaBloqueSuministro,
} from '../../../../types'

type RowError = { message: string; code?: string } | null

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null as RowError })),
  createCondominioRowReturning: vi.fn(async () => ({ data: null, error: null as RowError })),
  updateCondominioRow: vi.fn(async () => ({ error: null as RowError })),
  deleteCondominioRow: vi.fn(async () => ({ error: null as RowError })),
  cerrarTareaYConsumir: vi.fn(async () => ({
    data: { consumidos: 1, no_usados: 0, sin_stock: [] as unknown[] },
    error: null as RowError,
  })),
  fetchInsumosDeTareas: vi.fn(async () => ({
    insumos: [] as TareaBloqueSuministro[], error: null as { message: string } | null,
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
  id: 'per1', company_id: 'co1', project_id: 'p1', nombre: 'Ana',
  cargo: 'conserje', turno: 'diurno', estado: 'activo',
  created_at: '2026-01-01T00:00:00.000Z',
} as PersonalCondominio

const bloque = {
  id: 'blo1', company_id: 'co1', project_id: 'p1', personal_id: 'per1',
  turno: 'manana', fecha: HOY, estado: 'en_curso', foto_urls: [],
  created_at: '2026-01-01T00:00:00.000Z',
} as unknown as BloqueTurno

const TAREA: TareaBloque = {
  id: 'tar1', bloque_id: 'blo1', titulo: 'Limpiar la piscina',
  orden: 0, requiere_foto: false, estado: 'pendiente', foto_urls: [],
  created_at: '2026-01-01T00:00:00.000Z',
} as TareaBloque

function insumo(over: Partial<TareaBloqueSuministro> = {}): TareaBloqueSuministro {
  return {
    id: 'ins1', company_id: 'co1', project_id: 'p1', tarea_id: 'tar1',
    suministro_id: 'sum1', cantidad_planificada: 2,
    nombre_suministro: 'Cloro', unidad_medida: 'litro',
    movimiento_id: null, no_usado_en: null, created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

/** Monta y despliega el turno; los bloques vienen colapsados. */
function montar(insumos: TareaBloqueSuministro[], tarea: TareaBloque = TAREA) {
  mocks.fetchInsumosDeTareas.mockResolvedValue({ insumos, error: null })
  render(
    <TareasPersonalTab
      bloques={[bloque]}
      tareas={[tarea]}
      plantillas={[] as PlantillaTareaCargo[]}
      personal={[persona]}
      areas={[] as AreaCondominio[]}
      proyectoId="p1"
      companyId="co1"
      userId="u1"
      canCreate
      canEdit
      onRefresh={() => {}}
    />,
  )
  fireEvent.click(screen.getByText('▾'))
}

/**
 * Además abre el panel de la tarea. El botón 📋 sólo existe cuando la tarea
 * tiene algo que mostrar, así que esto NO sirve para el caso sin insumos —
 * ése usa `montar` a secas.
 */
async function montarConPanel(insumos: TareaBloqueSuministro[], tarea: TareaBloque = TAREA) {
  montar(insumos, tarea)
  fireEvent.click(await screen.findByLabelText(`Evidencia de ${tarea.titulo}`))
}

/** Los consumos que se mandaron a la RPC de cierre en la primera llamada. */
function consumosEnviados(): { suministro_id: string; cantidad: number }[] {
  const [, consumos] = mocks.cerrarTareaYConsumir.mock.calls[0] as unknown as
    [string, { suministro_id: string; cantidad: number }[], string | undefined]
  return consumos
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.cerrarTareaYConsumir.mockResolvedValue({
    data: { consumidos: 1, no_usados: 0, sin_stock: [] }, error: null,
  })
  mocks.fetchInsumosDeTareas.mockResolvedValue({ insumos: [], error: null })
})
afterEach(cleanup)

describe('TareasPersonalTab · el plan de insumos se muestra', () => {
  it('ofrece la cantidad planificada como punto de partida', async () => {
    await montarConPanel([insumo()])
    const campo = screen.getByLabelText('Cantidad usada de Cloro') as HTMLInputElement
    expect(campo.value).toBe('2')
    expect(screen.getByText('litro')).toBeTruthy()
  })

  it('la tarjeta avisa de lo pendiente sin abrir el panel', async () => {
    montar([insumo()])
    expect(await screen.findByText(/1 insumo por descontar/)).toBeTruthy()
  })

  it('lo ya descontado no se vuelve a ofrecer editable', async () => {
    // La RPC lo ignoraría igual (sólo toca filas sin movimiento), pero un campo
    // editable que no hace nada miente.
    await montarConPanel([insumo({ movimiento_id: 'mov1' })])
    expect(screen.getByText('✓ descontado')).toBeTruthy()
    expect(screen.queryByLabelText('Cantidad usada de Cloro')).toBeNull()
  })

  it('lo sellado como «no usado» tampoco: es terminal (20260907001000)', async () => {
    // El 0 declarado sella `no_usado_en` y la fila deja de ser reclamable.
    // Reabrirla es una corrección del admin, no un campo en esta pantalla.
    await montarConPanel([insumo({ no_usado_en: '2026-09-10T12:00:00.000Z' })])
    expect(screen.getByText('∅ no usado')).toBeTruthy()
    expect(screen.queryByLabelText('Cantidad usada de Cloro')).toBeNull()
    // Y la tarjeta ya no lo cuenta como pendiente.
    expect(screen.queryByText(/por descontar/)).toBeNull()
  })
})

describe('TareasPersonalTab · el cierre es UNA operación', () => {
  it('completar llama a la RPC de cierre y NO hace ningún UPDATE aparte', async () => {
    // La atomicidad es el punto entero de 20260907001000: si aquí apareciera un
    // updateCondominioRow del estado, volveríamos al mundo de dos requests.
    await montarConPanel([insumo()])
    fireEvent.click(screen.getByTitle('Completada'))

    await waitFor(() => expect(mocks.cerrarTareaYConsumir).toHaveBeenCalledTimes(1))
    const [tareaId] = mocks.cerrarTareaYConsumir.mock.calls[0] as unknown as [string]
    expect(tareaId).toBe('tar1')
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('si la RPC falla, la tarea sigue como estaba: no hubo otra escritura', async () => {
    // El rechazo del trigger de evidencia llega como error de la RPC y TODO
    // revirtió en la base. La pantalla traduce el mensaje y no toca nada más.
    mocks.cerrarTareaYConsumir.mockResolvedValue({
      data: null as never, error: { message: 'EVIDENCIA: falta foto' },
    })
    await montarConPanel([insumo()])
    fireEvent.click(screen.getByTitle('Completada'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    const [args] = mocks.notify.mock.calls[0] as unknown as
      [{ variant: string; title: string }]
    expect(args.variant).toBe('error')
    expect(args.title).toBe('Falta evidencia')
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('una tarea sin insumos cierra por la MISMA RPC, con consumos vacíos', async () => {
    // Un solo camino de cierre: también sin plan la evidencia y la transición
    // se validan en la transacción, no en un UPDATE suelto.
    montar([])
    fireEvent.click(screen.getByTitle('Completada'))

    await waitFor(() => expect(mocks.cerrarTareaYConsumir).toHaveBeenCalledTimes(1))
    expect(consumosEnviados()).toEqual([])
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('omitir no consume ni pasa por la RPC: no se hizo el trabajo', async () => {
    await montarConPanel([insumo()])
    fireEvent.click(screen.getByTitle('Omitir'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalled())
    expect(mocks.cerrarTareaYConsumir).not.toHaveBeenCalled()
  })

  it('el motivo declarado viaja a la RPC: es lo que deja pasar al trigger', async () => {
    const conFoto = { ...TAREA, requiere_foto: true } as TareaBloque
    await montarConPanel([insumo()], conFoto)
    fireEvent.change(screen.getByLabelText('Motivo para cerrar sin evidencia'),
      { target: { value: 'no hay cámara disponible' } })
    fireEvent.click(screen.getByText('Cerrar declarando el motivo'))

    await waitFor(() => expect(mocks.cerrarTareaYConsumir).toHaveBeenCalledTimes(1))
    const [, , motivo] = mocks.cerrarTareaYConsumir.mock.calls[0] as unknown as
      [string, unknown[], string | undefined]
    expect(motivo).toBe('no hay cámara disponible')
  })
})

describe('TareasPersonalTab · lo que se manda a descontar', () => {
  it('manda la cantidad DECLARADA, no la planificada', async () => {
    // El inventario sirve para reflejar el consumo real: descontar siempre la
    // receta lo convertiría en una estimación.
    await montarConPanel([insumo()])
    fireEvent.change(screen.getByLabelText('Cantidad usada de Cloro'), { target: { value: '5' } })
    fireEvent.click(screen.getByTitle('Completada'))

    await waitFor(() => expect(mocks.cerrarTareaYConsumir).toHaveBeenCalled())
    expect(consumosEnviados()).toEqual([{ suministro_id: 'sum1', cantidad: 5 }])
  })

  it('el 0 se manda como 0 y no se omite', async () => {
    // Omitir y declarar 0 son cosas distintas: el 0 es «no lo necesité» y ahora
    // SELLA la fila (no_usado_en) para que un reintento no la consuma después.
    await montarConPanel([insumo()])
    fireEvent.change(screen.getByLabelText('Cantidad usada de Cloro'), { target: { value: '0' } })
    fireEvent.click(screen.getByTitle('Completada'))

    await waitFor(() => expect(mocks.cerrarTareaYConsumir).toHaveBeenCalled())
    expect(consumosEnviados()).toEqual([{ suministro_id: 'sum1', cantidad: 0 }])
  })

  it('sin tocar nada manda lo planificado', async () => {
    await montarConPanel([insumo({ cantidad_planificada: 3 })])
    fireEvent.click(screen.getByTitle('Completada'))

    await waitFor(() => expect(mocks.cerrarTareaYConsumir).toHaveBeenCalled())
    expect(consumosEnviados()).toEqual([{ suministro_id: 'sum1', cantidad: 3 }])
  })

  it('no manda lo ya descontado ni lo sellado como no usado', async () => {
    await montarConPanel([
      insumo({ id: 'ins1', suministro_id: 'sum1' }),
      insumo({ id: 'ins2', suministro_id: 'sum2', nombre_suministro: 'Bolsas', movimiento_id: 'mov1' }),
      insumo({ id: 'ins3', suministro_id: 'sum3', nombre_suministro: 'Escoba', no_usado_en: '2026-09-10T12:00:00.000Z' }),
    ])
    fireEvent.click(screen.getByTitle('Completada'))

    await waitFor(() => expect(mocks.cerrarTareaYConsumir).toHaveBeenCalled())
    expect(consumosEnviados().map(c => c.suministro_id)).toEqual(['sum1'])
  })
})

describe('TareasPersonalTab · la falta de existencias avisa, no bloquea', () => {
  it('el faltante se muestra como advertencia y dice cuánto había', async () => {
    // El cierre YA ocurrió y el insumo se gastó de verdad: esto es para que
    // alguien reponga, no para culpar a quien ejecutó.
    mocks.cerrarTareaYConsumir.mockResolvedValue({
      data: {
        consumidos: 1, no_usados: 0,
        sin_stock: [{ suministro_id: 'sum1', nombre: 'Cloro', unidad: 'litro', pedido: 5, disponible: 2 }],
      },
      error: null,
    })
    await montarConPanel([insumo()])
    fireEvent.click(screen.getByTitle('Completada'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    const [args] = mocks.notify.mock.calls[0] as unknown as
      [{ variant: string; title: string; text: string }]
    expect(args.variant).toBe('warning')
    expect(args.text).toMatch(/Cloro/)
    expect(args.text).toMatch(/había 2/)
  })

  it('un rechazo de la RPC sí es error', async () => {
    mocks.cerrarTareaYConsumir.mockResolvedValue({
      data: null as unknown as { consumidos: number; no_usados: number; sin_stock: unknown[] },
      error: { message: 'no autorizado' },
    })
    await montarConPanel([insumo()])
    fireEvent.click(screen.getByTitle('Completada'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    const [args] = mocks.notify.mock.calls[0] as unknown as [{ variant: string }]
    expect(args.variant).toBe('error')
  })
})
