// El operativo puede reportar lo que encontró (columnas de 20260907000100).
//
// EL AGUJERO QUE CIERRA. `novedad`, `prioridad` y `requiere_mantenimiento`
// llegaron a `tareas_bloque` «para paridad con ejecuciones_limpieza» y quedaron
// INALCANZABLES: cerrar «con observación» guardaba un texto en
// `notas_operativo` y nada más. Un conserje que encontraba una fuga en su turno
// no tenía dónde decirlo — en Limpieza sí, en Turnos no.
//
// Lo que se cubre aquí es la captura: que el diálogo pida los mismos cuatro
// campos que la ruta de limpieza, que el checkbox llegue a la base como boolean
// (PromptDialog devuelve 'true' / '' como STRING — el error fácil de repetir),
// y que `notas_operativo` no se reescriba, porque las filas viejas significan
// lo que significaban el día que se llenaron.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type {
  AreaCondominio, BloqueTurno, PersonalCondominio, PlantillaTareaCargo, TareaBloque,
} from '../../../../types'

type RowError = { message: string; code?: string } | null

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null as RowError })),
  createCondominioRowReturning: vi.fn(async () => ({ data: null, error: null as RowError })),
  updateCondominioRow: vi.fn(async () => ({ error: null as RowError })),
  deleteCondominioRow: vi.fn(async () => ({ error: null as RowError })),
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

const persona: PersonalCondominio = {
  id: 'per1', company_id: 'co1', project_id: 'p1', nombre: 'Ana',
  cargo: 'conserje', turno: 'diurno', estado: 'activo',
  created_at: '2026-01-01T00:00:00.000Z',
} as PersonalCondominio

const bloque: BloqueTurno = {
  id: 'blo1', company_id: 'co1', project_id: 'p1', personal_id: 'per1',
  turno: 'manana', fecha: HOY, estado: 'en_curso', foto_urls: [],
  created_at: '2026-01-01T00:00:00.000Z',
} as unknown as BloqueTurno

function tarea(over: Partial<TareaBloque> = {}): TareaBloque {
  return {
    id: 'tar1', bloque_id: 'blo1', titulo: 'Barrer el borde',
    orden: 0, requiere_foto: false, estado: 'pendiente', foto_urls: [],
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  } as TareaBloque
}

/** Monta y despliega el turno: los bloques vienen colapsados. */
function montar(tareas: TareaBloque[]) {
  const r = render(
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
      onRefresh={() => {}}
    />,
  )
  fireEvent.click(screen.getByText('▾'))
  return r
}

/** El patch que se mandó a la base en el primer UPDATE. */
function patchEnviado(): Record<string, unknown> {
  const [, , patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as
    [string, string, Record<string, unknown>]
  return patch
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
})
afterEach(cleanup)

describe('TareasPersonalTab · la novedad se puede capturar', () => {
  it('el diálogo pide los mismos cuatro campos que la ruta de limpieza', async () => {
    // Un hallazgo de turno y uno de limpieza terminan en el mismo listado: si
    // se capturan distinto, uno de los dos llega sin prioridad.
    mocks.openPromptDialog.mockResolvedValue(null)
    montar([tarea()])
    fireEvent.click(screen.getByTitle('Con observación'))

    await waitFor(() => expect(mocks.openPromptDialog).toHaveBeenCalled())
    const [opciones] = mocks.openPromptDialog.mock.calls[0] as unknown as
      [{ fields: { name: string; control: string; required?: boolean }[] }]
    const nombres = opciones.fields.map(f => f.name)
    expect(nombres).toEqual(['novedad', 'prioridad', 'requiere_mantenimiento'])
    expect(opciones.fields[0].required).toBe(true)
    expect(opciones.fields[2].control).toBe('checkbox')
  })

  it('guarda novedad, prioridad y la bandera de mantenimiento', async () => {
    mocks.openPromptDialog.mockResolvedValue({
      novedad: '  La llave del lavamanos gotea  ',
      prioridad: 'alta',
      requiere_mantenimiento: 'true',
    })
    montar([tarea()])
    fireEvent.click(screen.getByTitle('Con observación'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalled())
    const patch = patchEnviado()
    expect(patch.estado).toBe('con_observacion')
    expect(patch.novedad).toBe('La llave del lavamanos gotea')
    expect(patch.prioridad).toBe('alta')
    expect(patch.requiere_mantenimiento).toBe(true)
  })

  it('el checkbox llega como boolean, no como el string que devuelve el diálogo', async () => {
    // PromptDialog entrega 'true' / '' — y `'' == false` sólo por accidente.
    // Mandar el string crudo haría que `requiere_mantenimiento` fuera SIEMPRE
    // verdadero en Postgres, que es peor que no capturarlo.
    mocks.openPromptDialog.mockResolvedValue({
      novedad: 'algo', prioridad: 'media', requiere_mantenimiento: '',
    })
    montar([tarea()])
    fireEvent.click(screen.getByTitle('Con observación'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalled())
    expect(patchEnviado().requiere_mantenimiento).toBe(false)
  })

  it('sin prioridad elegida cae a media, no a null', async () => {
    // `null` la mandaría al fondo del listado con peso de «baja»: quien reporta
    // no eligió «sin importancia», simplemente no tocó el select.
    mocks.openPromptDialog.mockResolvedValue({
      novedad: 'algo', prioridad: '', requiere_mantenimiento: '',
    })
    montar([tarea()])
    fireEvent.click(screen.getByTitle('Con observación'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalled())
    expect(patchEnviado().prioridad).toBe('media')
  })

  it('NO reescribe notas_operativo', async () => {
    // La columna vieja se lee como respaldo, no se pisa: cambiar lo que decía
    // sería reescribir el significado que tenía el día que se llenó.
    mocks.openPromptDialog.mockResolvedValue({
      novedad: 'algo', prioridad: 'media', requiere_mantenimiento: '',
    })
    montar([tarea({ notas_operativo: 'lo que se anotó en su momento' })])
    fireEvent.click(screen.getByTitle('Con observación'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalled())
    expect(patchEnviado()).not.toHaveProperty('notas_operativo')
  })

  it('cancelar el diálogo no escribe nada', async () => {
    mocks.openPromptDialog.mockResolvedValue(null)
    montar([tarea()])
    fireEvent.click(screen.getByTitle('Con observación'))

    await waitFor(() => expect(mocks.openPromptDialog).toHaveBeenCalled())
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('un rechazo de la base se avisa en vez de tragarse', async () => {
    // Antes esta rama ignoraba el `error` y refrescaba igual: el operativo veía
    // su tarea sin la observación y sin saber por qué.
    mocks.openPromptDialog.mockResolvedValue({
      novedad: 'algo', prioridad: 'media', requiere_mantenimiento: '',
    })
    mocks.updateCondominioRow.mockResolvedValue({ error: { message: 'permission denied' } })
    montar([tarea()])
    fireEvent.click(screen.getByTitle('Con observación'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    const [args] = mocks.notify.mock.calls[0] as unknown as [{ title: string; text: string }]
    expect(args.title).toBe('Error')
    expect(args.text).toBe('permission denied')
  })
})

describe('TareasPersonalTab · la tarjeta muestra lo reportado', () => {
  it('rinde la novedad nueva', () => {
    montar([tarea({ estado: 'con_observacion', novedad: 'La llave gotea' })])
    expect(screen.getByText(/⚠ La llave gotea/)).toBeTruthy()
  })

  it('cae a notas_operativo en las filas anteriores a la captura', () => {
    montar([tarea({ estado: 'con_observacion', notas_operativo: 'la reja no cierra' })])
    expect(screen.getByText(/⚠ la reja no cierra/)).toBeTruthy()
  })

  it('la bandera de mantenimiento se ve sin abrir nada', () => {
    montar([tarea({ estado: 'con_observacion', novedad: 'fuga', requiere_mantenimiento: true })])
    expect(screen.getByText(/🛠 Requiere mantenimiento/)).toBeTruthy()
  })
})
