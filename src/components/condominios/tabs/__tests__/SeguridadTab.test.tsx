// Seguridad: los formularios (novedad, iniciar ronda) dejan de ir encima de la
// lista y pasan a ventana; el detalle de novedad, el cierre de un punto y la
// verificación de acceso pasan a la ventana común (pantalla completa en el
// teléfono, Esc, no se cierran mientras guardan), y cada ronda tiene su
// detalle con los puntos y las novedades vinculadas. Además: un fallo al cerrar
// un punto ya no pierde lo escrito, iniciar una ronda avisa si su checklist no
// se creó, cerrar una ronda avisa si falla, y «novedades hoy» cuenta el día
// local.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type {
  NovedadSeguridad, PuntoControlRuta, RondaSeguridad, RutaRonda, Unidad, VisitaControl,
} from '../../../../types'

type Err = { message: string } | null

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (..._a: unknown[]) => ({ error: null as Err })),
  createCondominioRowReturning: vi.fn(async (..._a: unknown[]) => ({ data: { id: 'rNueva' } as Record<string, unknown> | null, error: null as Err })),
  updateCondominioRow: vi.fn(async (..._a: unknown[]) => ({ error: null as Err })),
  deleteCondominioRow: vi.fn(async (..._a: unknown[]) => ({ error: null as Err })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  createCondominioRowReturning: mocks.createCondominioRowReturning,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({ fetchVisitantesPorDpi: vi.fn(async () => ({ data: [], error: null })) }))
vi.mock('../../../../lib/validatedInsert', () => ({ validatedInsert: vi.fn(async () => ({ error: null })) }))
vi.mock('../../../../lib/storageUrls', () => ({ useSignedUrl: () => null, useSignedUrls: () => ({}) }))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
// El cargador real sube a Storage; aquí un botón que «agrega una foto».
vi.mock('../../../shared/ImageUploader', () => ({
  MultiImageUploader: ({ values, onChange, label }: { values: string[]; onChange: (v: string[]) => void; label: string }) =>
    <button type="button" onClick={() => onChange([...values, `foto${values.length + 1}.jpg`])}>{`${label} (${values.length})`}</button>,
  ImageUploader: () => null,
}))

const { SeguridadTab } = await import('../SeguridadTab')

const RUTA: RutaRonda = { id: 'ru1', company_id: 'co1', project_id: 'p1', nombre: 'Perímetro', activo: true, tiempo_estimado_min: 20, created_at: '' }
const PUNTOS: PuntoControlRuta[] = [
  { id: 'pt1', ruta_id: 'ru1', area_id: 'a1', orden: 1, created_at: '', punto_nombre: 'Portón norte', area_nombre: 'Garita', area_icono: '🚧' },
  { id: 'pt2', ruta_id: 'ru1', area_id: 'a2', orden: 2, created_at: '', punto_nombre: 'Cuarto de bombas', area_nombre: 'Sótano', area_icono: '🔧' },
]

function ronda(over: Partial<RondaSeguridad> = {}): RondaSeguridad {
  return { id: 'ro1', company_id: 'co1', project_id: 'p1', guardia_id: 'u1', ruta_id: 'ru1', inicio: '2026-10-23T14:00:00Z', fin: null, estado: 'en_curso', notas: null, created_at: '', ...over }
}
function visita(over: Partial<VisitaControl>): VisitaControl {
  return { id: 'v1', ronda_id: 'ro1', punto_id: 'pt1', estado: 'pendiente', notas: null, visitado_en: null, created_at: '', foto_urls: [], ...over }
}
function novedad(over: Partial<NovedadSeguridad>): NovedadSeguridad {
  return { id: 'n1', company_id: 'co1', project_id: 'p1', ronda_id: null, tipo: 'observacion', descripcion: 'Luz fundida en el pasillo', ubicacion: 'Nivel 2', prioridad: 'normal', created_at: '2026-10-23T15:00:00Z', ...over }
}

function props(over: Partial<Parameters<typeof SeguridadTab>[0]> = {}): Parameters<typeof SeguridadTab>[0] {
  return {
    rondas: [], novedades: [], rutas: [RUTA], puntosControl: PUNTOS, visitasControl: [], areas: [], visitantes: [],
    unidades: [{ id: 'un1', nombre: 'Casa 4', activo: true }] as unknown as Unidad[], reservasSTR: [],
    proyectoId: 'p1', companyId: 'co1', userId: 'u1', canCreate: true, canEdit: true, canDelete: true, onRefresh: vi.fn(), ...over,
  }
}

function esperar<T>() {
  let resolver!: (v: T) => void
  const promesa = new Promise<T>(res => { resolver = res })
  return { promesa, resolver }
}

const TZ_ORIGINAL = process.env.TZ
beforeEach(() => {
  vi.clearAllMocks()
  mocks.createCondominioRow.mockResolvedValue({ error: null })
  mocks.createCondominioRowReturning.mockResolvedValue({ data: { id: 'rNueva' }, error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.deleteCondominioRow.mockResolvedValue({ error: null })
  mocks.confirm.mockResolvedValue({ isConfirmed: true })
})
afterEach(() => { cleanup(); vi.useRealTimers(); process.env.TZ = TZ_ORIGINAL })

describe('Seguridad — formularios en ventana', () => {
  it('«+ Novedad»: a pantalla completa, no se cierra mientras guarda, y si falla conserva lo escrito', async () => {
    const onRefresh = vi.fn()
    render(<SeguridadTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Novedad' }))
    const ventana = screen.getByRole('dialog', { name: 'Registrar novedad' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(screen.getByLabelText('Descripción *'), { target: { value: 'Portón trabado' } })
    fireEvent.change(screen.getByLabelText('Prioridad'), { target: { value: 'alta' } })
    mocks.createCondominioRow.mockResolvedValueOnce({ error: { message: 'Sin conexión' } })
    fireEvent.click(within(ventana).getByRole('button', { name: 'Registrar' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Sin conexión' })))
    expect((screen.getByLabelText('Descripción *') as HTMLTextAreaElement).value).toBe('Portón trabado')

    const guardado = esperar<{ error: null }>()
    mocks.createCondominioRow.mockReturnValueOnce(guardado.promesa)
    fireEvent.click(within(ventana).getByRole('button', { name: 'Registrar' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(2))
    expect(mocks.createCondominioRow).toHaveBeenLastCalledWith('novedades_seguridad', expect.objectContaining({ descripcion: 'Portón trabado', prioridad: 'alta' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(ventana).getByLabelText('Cerrar modal'))
    expect(screen.getByRole('dialog', { name: 'Registrar novedad' })).toBeTruthy()

    guardado.resolver({ error: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('iniciar una ronda con ruta crea su checklist; si el checklist falla, lo avisa', async () => {
    const onRefresh = vi.fn()
    render(<SeguridadTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: '🛡 Iniciar ronda' }))
    const ventana = screen.getByRole('dialog', { name: '🛡 Iniciar ronda de seguridad' })
    fireEvent.change(screen.getByLabelText('Ruta de ronda'), { target: { value: 'ru1' } })
    mocks.createCondominioRow.mockResolvedValueOnce({ error: { message: 'permiso denegado' } })
    fireEvent.click(within(ventana).getByRole('button', { name: '🛡 Iniciar ahora' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('visitas_control', [
      { ronda_id: 'rNueva', punto_id: 'pt1', estado: 'pendiente' },
      { ronda_id: 'rNueva', punto_id: 'pt2', estado: 'pendiente' },
    ]))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'error', title: 'La ronda se inició sin su checklist',
    })))
    // La ronda sí existe: la ventana se cierra y la lista se recarga.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })
})

describe('Seguridad — la ronda en curso', () => {
  const enCurso = () => props({ rondas: [ronda()], visitasControl: [visita({}), visita({ id: 'v2', punto_id: 'pt2' })] })

  it('si cerrar un punto con novedad falla, la ventana sigue abierta con lo escrito y las fotos', async () => {
    render(<SeguridadTab {...enCurso()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Registrar novedad en Portón norte' }))
    const ventana = screen.getByRole('dialog', { name: '🚧 Portón norte' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)
    fireEvent.change(screen.getByLabelText('Novedad *'), { target: { value: 'Candado forzado' } })
    fireEvent.click(within(ventana).getByRole('button', { name: /^Evidencia fotográfica/ }))

    mocks.updateCondominioRow.mockResolvedValueOnce({ error: { message: 'sin red' } })
    fireEvent.click(within(ventana).getByRole('button', { name: 'Registrar novedad' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'No se pudo cerrar el punto' })))
    expect((screen.getByLabelText('Novedad *') as HTMLTextAreaElement).value).toBe('Candado forzado')
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Evidencia fotográfica (1)' })).toBeTruthy()

    fireEvent.click(within(ventana).getByRole('button', { name: 'Registrar novedad' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocks.updateCondominioRow).toHaveBeenLastCalledWith('visitas_control', 'v1', expect.objectContaining({
      estado: 'novedad', notas: 'Candado forzado', foto_urls: ['foto1.jpg'],
    }))
  })

  it('cerrar la ronda espera mientras guarda y avisa si falla', async () => {
    render(<SeguridadTab {...enCurso()} />)
    const cierre = esperar<{ error: Err }>()
    mocks.updateCondominioRow.mockReturnValueOnce(cierre.promesa)
    fireEvent.click(screen.getByRole('button', { name: '✓ Finalizar ronda' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('rondas_seguridad', 'ro1', expect.objectContaining({ estado: 'completada' })))
    // Mientras tanto, ni ese botón ni «Marcar incompleta» aceptan otro toque.
    expect((screen.getByRole('button', { name: 'Cerrando…' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Marcar incompleta' }) as HTMLButtonElement).disabled).toBe(true)

    cierre.resolver({ error: { message: 'permiso denegado' } })
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'No se pudo cerrar la ronda', text: 'permiso denegado' })))
    expect((screen.getByRole('button', { name: '✓ Finalizar ronda' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('Seguridad — listas y detalles', () => {
  it('«novedades hoy» cuenta el día local, y las críticas son las de hoy', () => {
    process.env.TZ = 'America/Guatemala'
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-24T02:00:00Z')) // 23 oct, 8 de la noche en Guatemala
    render(<SeguridadTab {...props({ novedades: [
      novedad({ id: 'a', created_at: '2026-10-24T01:30:00Z', prioridad: 'critica' }), // 23 oct 19:30 local
      novedad({ id: 'b', created_at: '2026-10-23T15:00:00Z' }),
      novedad({ id: 'c', created_at: '2026-10-22T15:00:00Z', prioridad: 'critica' }), // ayer
    ] })} />)
    expect(screen.getByText(/novedades hoy/).textContent).toBe('2 novedades hoy · 1 crítica')
  })

  it('tocar una novedad abre su detalle; eliminar pregunta, y cancelar o fallar no lo cierra', async () => {
    const { container } = render(<SeguridadTab {...props({ novedades: [novedad({})] })} />)
    fireEvent.click(within(container).getByText('Luz fundida en el pasillo'))
    const detalle = screen.getByRole('dialog', { name: '👁 Observación' })
    expect(detalle.classList.contains('at-modal--fs-mobile')).toBe(true)

    mocks.confirm.mockResolvedValueOnce({ isConfirmed: false })
    fireEvent.click(within(detalle).getByRole('button', { name: '🗑 Eliminar' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('dialog', { name: '👁 Observación' })).toBeTruthy()

    mocks.deleteCondominioRow.mockResolvedValueOnce({ error: { message: 'sin red' } })
    fireEvent.click(within(detalle).getByRole('button', { name: '🗑 Eliminar' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'sin red' })))
    expect(screen.getByRole('dialog', { name: '👁 Observación' })).toBeTruthy()

    fireEvent.click(within(detalle).getByRole('button', { name: '🗑 Eliminar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocks.deleteCondominioRow).toHaveBeenLastCalledWith('novedades_seguridad', 'n1')
  })

  it('cada ronda tiene su detalle: los puntos con su resultado y notas, y sus novedades', () => {
    render(<SeguridadTab {...props({
      rondas: [ronda({ estado: 'completada', fin: '2026-10-23T14:35:00Z', notas: 'Sin luz en el sótano' })],
      visitasControl: [
        visita({ id: 'v2', punto_id: 'pt2', estado: 'novedad', notas: 'Fuga en la bomba 2', foto_urls: ['f.jpg'] }),
        visita({ id: 'v1', estado: 'ok' }),
      ],
      novedades: [novedad({ ronda_id: 'ro1', tipo: 'incidente', descripcion: 'Fuga de agua en el cuarto de bombas', prioridad: 'alta' })],
    })} />)
    fireEvent.click(screen.getByRole('button', { name: /Rondas \(1\)/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Ver ronda del / }))
    const detalle = screen.getByRole('dialog', { name: /^🛡️ Ronda del / })
    expect(detalle.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(detalle.textContent).toContain('Duración35 min')
    expect(within(detalle).getByText('Puntos de control (2/2)')).toBeTruthy()
    // En el orden de la ruta, no en el de llegada.
    const puntos = within(detalle).getAllByRole('listitem').filter(li => li.closest('ol'))
    expect(puntos.map(li => li.textContent?.includes('Portón norte'))).toEqual([true, false])
    expect(within(detalle).getByText('Fuga en la bomba 2')).toBeTruthy()

    // La novedad vinculada se abre encima.
    fireEvent.click(within(detalle).getByRole('button', { name: /Fuga de agua en el cuarto de bombas/ }))
    expect(screen.getByRole('dialog', { name: '🚨 Incidente' })).toBeTruthy()
  })

  it('verificar acceso abre a pantalla completa y Esc la cierra', () => {
    render(<SeguridadTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '🚪 Verificar acceso' }))
    const ventana = screen.getByRole('dialog', { name: '🚪 Registro de acceso' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(screen.getByLabelText('DPI / Identificación')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
