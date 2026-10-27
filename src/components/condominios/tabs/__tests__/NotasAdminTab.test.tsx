// Minutas: la lista resume abiertas, compromisos pendientes y vencidos; la
// nueva minuta va en ventana y en tres pasos —participantes (empleado,
// propietario/inquilino, proveedor u otro, con quien gestiona), puntos y
// acuerdos/compromisos por punto—; el detalle marca compromisos cumplidos,
// cierra la minuta y abre la edición con lo guardado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import type { ContratoArrendamiento, ContratoProveedor, NotaAdmin, PersonalCondominio, Unidad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  updateCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  updateCondominioRowAfectando: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  deleteCondominioRowAfectando: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  removeMedia: vi.fn(async (_bucket: string, _paths: string[]) => ({ error: null as string | null })),
  borrarAlQuitar: [] as (boolean | undefined)[],
  /** Últimas props de cada uploader: para simular una subida que termina tarde. */
  uploader: {} as Record<'fotos' | 'documentos', { values: string[]; onChange: (v: string[]) => void }>,
  fetchResidentesProyecto: vi.fn(async (_projectId: string) => [
    { id: 'r1', unidad_id: 'u2', cliente_id: 'c1', tipo: 'propietario', nombre: 'María Pérez', unidad_nombre: 'Casa 2' },
  ]),
  useProveedoresQuery: vi.fn(() => ({ data: [{ id: 'v1', company_id: 'co1', nombre: 'Limpiezas SA', activo: true, contacto_nombre: 'Rosa' }], isLoading: false })),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  updateCondominioRowAfectando: mocks.updateCondominioRowAfectando,
  deleteCondominioRowAfectando: mocks.deleteCondominioRowAfectando,
}))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify, confirm: mocks.confirm }))
vi.mock('../../../../domain/cxp/queries', () => ({ useProveedoresQuery: mocks.useProveedoresQuery }))
vi.mock('../../../../domain/shared/storage', () => ({ removeMedia: mocks.removeMedia }))
// Los uploaders reales suben al bucket; aquí sólo importa qué lista devuelven
// y cuándo avisan que están subiendo.
type PropsUploader = { values: string[]; onChange: (v: string[]) => void; borrarAlQuitar?: boolean; onSubiendo?: (v: boolean) => void }
vi.mock('../../../shared/ImageUploader', () => ({
  MultiImageUploader: (p: PropsUploader) => {
    mocks.borrarAlQuitar.push(p.borrarAlQuitar)
    mocks.uploader.fotos = p
    return (
      <div>
        <span data-testid="fotos-borrador">{p.values.join('|')}</span>
        <button type="button" onClick={() => p.onChange([...p.values, 'p1/minutas/nueva.jpg'])}>Simular subida</button>
        <button type="button" onClick={() => p.onChange(p.values.slice(1))}>Simular quitar primera</button>
        <button type="button" onClick={() => p.onSubiendo?.(true)}>Simular inicio de subida</button>
        <button type="button" onClick={() => p.onSubiendo?.(false)}>Simular fin de subida</button>
      </div>
    )
  },
}))
vi.mock('../../../shared/FileUploader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/FileUploader')>()),
  MultiFileUploader: (p: PropsUploader) => {
    mocks.borrarAlQuitar.push(p.borrarAlQuitar)
    mocks.uploader.documentos = p
    return (
      <div>
        <span data-testid="documentos-borrador">{p.values.join('|')}</span>
        <button type="button" onClick={() => p.onChange([...p.values, 'p1/minutas/1785540000000-ab12cd-acta.pdf'])}>Simular subida de documento</button>
        <button type="button" onClick={() => p.onChange(p.values.slice(1))}>Simular quitar primer documento</button>
      </div>
    )
  },
  ListaAdjuntos: ({ paths }: { paths: string[] }) => <div data-testid="adjuntos">{paths.join('|')}</div>,
}))
vi.mock('../../../shared/ImageGallery', () => ({
  ImageGallery: ({ urls }: { urls: string[] }) => <div data-testid="galeria">{urls.join('|')}</div>,
}))
vi.mock('../../../../domain/condominios/minutas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../domain/condominios/minutas')>()),
  fetchResidentesProyecto: mocks.fetchResidentesProyecto,
}))

const { default: NotasAdminTab } = await import('../NotasAdminTab')

const personal = [
  { id: 'e1', nombre: 'Carlos Guardia', cargo: 'guardia', estado: 'activo' },
  { id: 'e3', nombre: 'Ex Empleado', cargo: 'guardia', estado: 'inactivo' },
] as PersonalCondominio[]
const unidades = [
  { id: 'u1', nombre: 'Casa 1', propietario_nombre: 'Dueño Uno', activo: true },
  { id: 'u2', nombre: 'Casa 2', propietario_nombre: 'Dueño Dos', activo: true },
] as Unidad[]
const contratos = [{ id: 'k1', unidad_id: 'u1', arrendatario_nombre: 'Inquilino Uno', estado: 'activo' }] as ContratoArrendamiento[]
const contratosProveedores = [{ id: 'cp2', proveedor_nombre: 'Jardines GT', servicio: 'jardineria', estado: 'activo' }] as ContratoProveedor[]

function nota(over: Partial<NotaAdmin>): NotaAdmin {
  return {
    id: 'x', company_id: 'co1', project_id: 'p1', titulo: 'Minuta', contenido: '', categoria: 'reunion', prioridad: 'normal',
    fijada: false, resuelta: false, fecha_recordatorio: null, autor: 'Admin', fecha_reunion: '2026-10-20',
    participantes: [], puntos: [], created_at: '2026-10-20T15:00:00Z', ...over,
  }
}

const abierta = nota({
  id: 'n1', titulo: 'Reunión con el guardia', fecha_reunion: '2026-10-22', fecha_recordatorio: '2026-10-30', contenido: 'Revisar el turno nocturno',
  participantes: [
    { id: 'pa', tipo: 'otro', nombre: 'Admin', detalle: 'Administración', gestiona: true },
    { id: 'pb', tipo: 'empleado', ref_id: 'e1', nombre: 'Carlos Guardia', detalle: 'Guardia', gestiona: false },
  ],
  puntos: [
    { id: 'q1', titulo: 'Rondas nocturnas', descripcion: 'Se saltan la de las 2 am', acuerdos: [
      { id: 'a1', tipo: 'acuerdo', texto: 'Se mantiene el horario', cumplido: false },
      { id: 'c1', tipo: 'compromiso', texto: 'Registrar cada ronda', responsable_id: 'pb', fecha_limite: '2026-10-20', cumplido: false },
      { id: 'c2', tipo: 'compromiso', texto: 'Comprar linterna', responsable_id: 'pa', fecha_limite: '2026-11-05', cumplido: true, cumplido_at: '2026-10-23T00:00:00Z' },
    ] },
  ],
})
const cerrada = nota({ id: 'n2', titulo: 'Reunión con jardinería', resuelta: true, fecha_reunion: '2026-09-01',
  participantes: [{ id: 'pz', tipo: 'proveedor', nombre: 'Jardines GT', gestiona: false }], puntos: [{ id: 'q9', titulo: 'Poda', acuerdos: [] }] })

function props(over: Partial<Parameters<typeof NotasAdminTab>[0]> = {}): Parameters<typeof NotasAdminTab>[0] {
  return {
    notas: [abierta, cerrada], proyectoId: 'p1', companyId: 'co1', autorNombre: 'Admin',
    personal, unidades, contratos, contratosProveedores, canCreate: true, canEdit: true, canDelete: true, onRefresh: vi.fn(), ...over,
  }
}

const dialogo = () => screen.getByRole('dialog')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.borrarAlQuitar.length = 0
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 26, 12, 0, 0)) // 26 oct 2026
  mocks.createCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRowAfectando.mockResolvedValue({ error: null })
  mocks.deleteCondominioRowAfectando.mockResolvedValue({ error: null })
  mocks.confirm.mockResolvedValue({ isConfirmed: true })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Minutas — lista', () => {
  it('resume abiertas, compromisos pendientes y vencidos, y la tarjeta muestra avance y seguimiento', () => {
    render(<NotasAdminTab {...props()} />)
    expect(screen.getByRole('button', { name: /Abiertas\s*1/ })).toBeTruthy()
    expect(screen.getByText('Compromisos pendientes').nextSibling?.textContent).toBe('1')
    expect(screen.getByRole('button', { name: /Compromisos vencidos\s*1/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Cerradas\s*1/ })).toBeTruthy()

    // Solo abiertas por defecto
    expect(screen.getByText('Reunión con el guardia')).toBeTruthy()
    expect(screen.queryByText('Reunión con jardinería')).toBeNull()
    const tarjeta = screen.getByText('Reunión con el guardia').closest('button')!
    expect(tarjeta.textContent).toContain('1/2 compromisos cumplidos')
    expect(tarjeta.textContent).toContain('1 vencido')
    expect(tarjeta.textContent).toContain('Gestiona Admin')
    expect(tarjeta.textContent).toContain('1 punto · 1 acuerdo')
    expect(tarjeta.textContent).toMatch(/Seguimiento en 4 días/)

    fireEvent.click(screen.getByRole('radio', { name: /Cerradas/ }))
    expect(screen.getByText('Reunión con jardinería')).toBeTruthy()
    expect(screen.queryByText('Reunión con el guardia')).toBeNull()

    // Buscar por participante, en todas
    fireEvent.click(screen.getByRole('radio', { name: /Todas/ }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar minuta' }), { target: { value: 'jardines' } })
    expect(screen.getByText('Reunión con jardinería')).toBeTruthy()
    expect(screen.queryByText('Reunión con el guardia')).toBeNull()
  })

  it('sin minutas ofrece crear la primera; sin permiso de crear no hay botón', () => {
    const { unmount } = render(<NotasAdminTab {...props({ notas: [] })} />)
    expect(screen.getByText('Aún no hay minutas')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '+ Nueva minuta' })).toHaveLength(2)
    unmount()
    render(<NotasAdminTab {...props({ notas: [], canCreate: false })} />)
    expect(screen.queryByRole('button', { name: '+ Nueva minuta' })).toBeNull()
  })
})

describe('Minutas — nueva en tres pasos', () => {
  it('participantes de las listas y otro por nombre, puntos, acuerdos y compromisos; guarda todo', async () => {
    const onRefresh = vi.fn()
    render(<NotasAdminTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva minuta' }))
    const d = dialogo()
    expect(within(d).getByText(/Paso 1 de 3/)).toBeTruthy()

    // Quien la crea ya está como gestor
    expect(within(d).getByText('Admin')).toBeTruthy()
    expect(within(d).getByText('★ Gestiona')).toBeTruthy()

    // Sin título no se avanza
    fireEvent.click(within(d).getByRole('button', { name: 'Siguiente →' }))
    expect(mocks.notify).toHaveBeenLastCalledWith(expect.objectContaining({ variant: 'warning', text: expect.stringMatching(/título/) }))
    expect(within(d).getByText(/Paso 1 de 3/)).toBeTruthy()

    fireEvent.change(within(d).getByLabelText('Título de la minuta *'), { target: { value: 'Turno nocturno' } })
    expect((within(d).getByLabelText('Fecha de la reunión *') as HTMLInputElement).value).toBe('2026-10-26')

    // Empleado (el inactivo no aparece)
    fireEvent.click(within(d).getByRole('button', { name: 'Agregar a Carlos Guardia' }))
    expect(within(d).queryByRole('button', { name: /Ex Empleado/ })).toBeNull()
    expect(within(d).getByRole('button', { name: 'Carlos Guardia ya está en la minuta' })).toBeTruthy()

    // Propietario / inquilino: residente de unidad, dueño registrado e inquilino de contrato
    fireEvent.click(within(d).getByRole('radio', { name: /Propietario \/ inquilino/ }))
    fireEvent.click(await within(d).findByRole('button', { name: 'Agregar a María Pérez' }))
    expect(within(d).getByRole('button', { name: 'Agregar a Dueño Uno' })).toBeTruthy()
    expect(within(d).getByRole('button', { name: 'Agregar a Inquilino Uno' })).toBeTruthy()
    // Casa 2 ya tiene propietaria como residente: el dueño registrado no se duplica
    expect(within(d).queryByRole('button', { name: 'Agregar a Dueño Dos' })).toBeNull()

    // Proveedor: catálogo + contrato del condominio
    fireEvent.click(within(d).getByRole('radio', { name: /Proveedor/ }))
    expect(within(d).getByRole('button', { name: 'Agregar a Jardines GT' })).toBeTruthy()
    fireEvent.change(within(d).getByRole('searchbox', { name: /Buscar proveedores/ }), { target: { value: 'limpie' } })
    expect(within(d).queryByRole('button', { name: 'Agregar a Jardines GT' })).toBeNull()
    fireEvent.click(within(d).getByRole('button', { name: 'Agregar a Limpiezas SA' }))

    // Otro por nombre
    fireEvent.click(within(d).getByRole('radio', { name: /Otro/ }))
    fireEvent.change(within(d).getByLabelText('Nombre *'), { target: { value: 'Lic. Rodríguez' } })
    fireEvent.change(within(d).getByLabelText('Detalle'), { target: { value: 'Abogado externo' } })
    fireEvent.click(within(d).getByRole('button', { name: '+ Agregar' }))
    expect(within(d).getByText('Participantes (5)')).toBeTruthy()

    // Cambiar quien gestiona y quitar a uno
    fireEvent.click(within(d).getAllByRole('button', { name: 'Hacer gestor' })[0]) // Carlos
    const tarjetaCarlos = within(d).getByText('Carlos Guardia').closest('div')!.parentElement!
    expect(tarjetaCarlos.textContent).toContain('★ Gestiona')
    fireEvent.click(within(d).getByRole('button', { name: 'Quitar a Lic. Rodríguez' }))
    expect(within(d).getByText('Participantes (4)')).toBeTruthy()

    // Paso 2: puntos
    fireEvent.click(within(d).getByRole('button', { name: 'Siguiente →' }))
    expect(within(d).getByText(/Paso 2 de 3/)).toBeTruthy()
    fireEvent.click(within(d).getByRole('button', { name: 'Siguiente →' }))
    expect(mocks.notify).toHaveBeenLastCalledWith(expect.objectContaining({ variant: 'warning', text: expect.stringMatching(/punto/) }))
    fireEvent.click(within(d).getByRole('button', { name: '+ Agregar punto' }))
    fireEvent.change(within(d).getByLabelText('Punto 1'), { target: { value: 'Rondas nocturnas' } })
    fireEvent.change(within(d).getByLabelText('Detalle del punto 1'), { target: { value: 'Faltan las de madrugada' } })
    fireEvent.keyDown(within(d).getByLabelText('Punto 1'), { key: 'Enter' }) // Enter agrega el siguiente
    fireEvent.change(within(d).getByLabelText('Punto 2'), { target: { value: 'Uniforme' } })
    fireEvent.click(within(d).getByRole('button', { name: 'Quitar punto 2' }))
    expect(within(d).queryByLabelText('Punto 2')).toBeNull()

    // Paso 3: acuerdos y compromisos por punto
    fireEvent.click(within(d).getByRole('button', { name: 'Siguiente →' }))
    expect(within(d).getByText(/Paso 3 de 3/)).toBeTruthy()
    expect(within(d).getByText('Rondas nocturnas')).toBeTruthy()
    fireEvent.click(within(d).getByRole('button', { name: 'Agregar acuerdo al punto 1' }))
    fireEvent.change(within(d).getByLabelText('Acuerdo del punto 1'), { target: { value: 'Se mantiene el horario' } })
    fireEvent.click(within(d).getByRole('button', { name: 'Agregar compromiso al punto 1' }))
    fireEvent.change(within(d).getByLabelText('Compromiso del punto 1'), { target: { value: 'Registrar cada ronda' } })
    const responsable = within(d).getByLabelText('Responsable') as HTMLSelectElement
    const opcionCarlos = Array.from(responsable.options).find(o => o.textContent?.startsWith('Carlos Guardia'))!
    fireEvent.change(responsable, { target: { value: opcionCarlos.value } })
    fireEvent.change(within(d).getByLabelText('Fecha límite'), { target: { value: '2026-11-02' } })
    fireEvent.change(within(d).getByLabelText('Próximo seguimiento'), { target: { value: '2026-11-03' } })
    fireEvent.change(within(d).getByLabelText('Prioridad'), { target: { value: 'alta' } })

    fireEvent.click(within(d).getByRole('button', { name: '✅ Guardar minuta' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as [string, Record<string, unknown>]
    expect(tabla).toBe('notas_admin')
    expect(payload).toMatchObject({
      company_id: 'co1', project_id: 'p1', autor: 'Admin', titulo: 'Turno nocturno', fecha_reunion: '2026-10-26',
      categoria: 'reunion', prioridad: 'alta', fecha_recordatorio: '2026-11-03', fijada: false, contenido: '',
    })
    const participantes = payload.participantes as { tipo: string; nombre: string; gestiona: boolean; ref_id: string | null; detalle: string | null }[]
    expect(participantes.map(p => [p.tipo, p.nombre, p.gestiona])).toEqual([
      ['otro', 'Admin', false], ['empleado', 'Carlos Guardia', true], ['residente', 'María Pérez', false], ['proveedor', 'Limpiezas SA', false],
    ])
    expect(participantes[1]).toMatchObject({ ref_id: 'e1', detalle: 'Guardia' })
    expect(participantes[2]).toMatchObject({ ref_id: 'r1', detalle: 'Casa 2 · Propietario' })
    expect(participantes[3]).toMatchObject({ ref_id: 'v1', detalle: 'Rosa' })
    const puntos = payload.puntos as { titulo: string; descripcion: string | null; acuerdos: Record<string, unknown>[] }[]
    expect(puntos).toHaveLength(1)
    expect(puntos[0]).toMatchObject({ titulo: 'Rondas nocturnas', descripcion: 'Faltan las de madrugada' })
    expect(puntos[0].acuerdos[0]).toMatchObject({ tipo: 'acuerdo', texto: 'Se mantiene el horario', responsable_id: null, fecha_limite: null, cumplido: false })
    expect(puntos[0].acuerdos[1]).toMatchObject({ tipo: 'compromiso', texto: 'Registrar cada ronda', responsable_id: participantes[1] && (payload.participantes as { id: string }[])[1].id, fecha_limite: '2026-11-02', cumplido: false })
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('con el catálogo de cargos el empleado muestra el nombre del cargo; el error al guardar no cierra la ventana', async () => {
    mocks.createCondominioRow.mockResolvedValueOnce({ error: { message: 'sin permiso' } })
    render(<NotasAdminTab {...props({ cargos: [{ id: 'g', company_id: 'co1', project_id: 'p1', codigo: 'guardia', nombre: 'Guardia de seguridad', icono: '', orden: 1 } as never] })} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva minuta' }))
    const d = dialogo()
    expect(within(d).getByText('Guardia de seguridad')).toBeTruthy()
    fireEvent.change(within(d).getByLabelText('Título de la minuta *'), { target: { value: 'Prueba' } })
    fireEvent.click(within(d).getByRole('button', { name: 'Siguiente →' }))
    fireEvent.click(within(d).getByRole('button', { name: '+ Agregar punto' }))
    fireEvent.change(within(d).getByLabelText('Punto 1'), { target: { value: 'Tema' } })
    // Saltar al paso 3 desde el indicador
    fireEvent.click(within(d).getByRole('tab', { name: 'Paso 3 · Acuerdos' }))
    fireEvent.click(within(d).getByRole('button', { name: '✅ Guardar minuta' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenLastCalledWith(expect.objectContaining({ variant: 'error', text: 'sin permiso' })))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('Minutas — detalle', () => {
  it('muestra participantes, puntos y compromisos; marcar cumplido guarda los puntos', async () => {
    const onRefresh = vi.fn()
    render(<NotasAdminTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByText('Reunión con el guardia'))
    const d = screen.getByRole('dialog', { name: 'Reunión con el guardia' })
    expect(within(d).getByText('Revisar el turno nocturno')).toBeTruthy()
    expect(within(d).getByText('Participantes (2)')).toBeTruthy()
    expect(within(d).getByText('Puntos abordados (1)')).toBeTruthy()
    expect(within(d).getByText('1 de 2 compromisos cumplidos · 1 vencido')).toBeTruthy()
    expect(within(d).getByText(/venció hace 6 días/)).toBeTruthy()
    expect(within(d).getByText('👤 Carlos Guardia')).toBeTruthy()
    expect(within(d).getByText('Próximo seguimiento')).toBeTruthy()

    fireEvent.click(within(d).getByRole('checkbox', { name: 'Marcar cumplido: Registrar cada ronda' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [, id, patch] = mocks.updateCondominioRow.mock.calls[0] as [string, string, { puntos: { acuerdos: { id: string; cumplido: boolean; cumplido_at: string | null }[] }[] }]
    expect(id).toBe('n1')
    const c1 = patch.puntos[0].acuerdos.find(a => a.id === 'c1')!
    expect(c1.cumplido).toBe(true)
    expect(c1.cumplido_at).toBeTruthy()
    expect(patch.puntos[0].acuerdos.find(a => a.id === 'c2')!.cumplido).toBe(true)
    expect(within(d).getByText('2 de 2 compromisos cumplidos')).toBeTruthy()
    expect(onRefresh).toHaveBeenCalled()
  })

  it('cerrar la minuta avisa de los compromisos pendientes y la marca cerrada; sin editar no hay acciones', async () => {
    render(<NotasAdminTab {...props()} />)
    fireEvent.click(screen.getByText('Reunión con el guardia'))
    const d = screen.getByRole('dialog', { name: 'Reunión con el guardia' })
    fireEvent.click(within(d).getByRole('button', { name: '✓ Cerrar minuta' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringMatching(/Quedan 1 compromiso sin cumplir/) })))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('notas_admin', 'n1', { resuelta: true, fijada: false }))
    cleanup()

    render(<NotasAdminTab {...props({ canEdit: false, canDelete: false })} />)
    fireEvent.click(screen.getByText('Reunión con el guardia'))
    const d2 = screen.getByRole('dialog', { name: 'Reunión con el guardia' })
    expect(within(d2).queryByRole('button', { name: '✓ Cerrar minuta' })).toBeNull()
    expect(within(d2).queryByRole('button', { name: '✏️ Editar' })).toBeNull()
    expect(within(d2).queryByRole('button', { name: '🗑 Eliminar' })).toBeNull()
    expect((within(d2).getByRole('checkbox', { name: 'Marcar cumplido: Registrar cada ronda' }) as HTMLInputElement).disabled).toBe(true)
    expect(within(d2).getByRole('button', { name: '🖨 Imprimir' })).toBeTruthy()
  })

  it('una cerrada se reabre y una abierta se edita con lo guardado', async () => {
    render(<NotasAdminTab {...props()} />)
    fireEvent.click(screen.getByRole('radio', { name: /Cerradas/ }))
    fireEvent.click(screen.getByText('Reunión con jardinería'))
    const d = screen.getByRole('dialog', { name: 'Reunión con jardinería' })
    expect(within(d).queryByRole('button', { name: '✏️ Editar' })).toBeNull()
    fireEvent.click(within(d).getByRole('button', { name: '↺ Reabrir' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('notas_admin', 'n2', { resuelta: false }))
    fireEvent.click(within(d).getByRole('button', { name: 'Cerrar modal' }))

    fireEvent.click(screen.getByRole('radio', { name: /Abiertas/ }))
    fireEvent.click(screen.getByText('Reunión con el guardia'))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Reunión con el guardia' })).getByRole('button', { name: '✏️ Editar' }))
    const w = screen.getByRole('dialog', { name: '✏️ Editar minuta' })
    expect((within(w).getByLabelText('Título de la minuta *') as HTMLInputElement).value).toBe('Reunión con el guardia')
    expect((within(w).getByLabelText('Fecha de la reunión *') as HTMLInputElement).value).toBe('2026-10-22')
    expect(within(w).getByText('Participantes (2)')).toBeTruthy()
    fireEvent.click(within(w).getByRole('tab', { name: 'Paso 3 · Acuerdos' }))
    expect(within(w).getAllByLabelText(/^Compromiso del punto/, { selector: 'input' }).map(i => (i as HTMLInputElement).value)).toEqual(['Registrar cada ronda', 'Comprar linterna'])
    expect((within(w).getByLabelText('Próximo seguimiento') as HTMLInputElement).value).toBe('2026-10-30')
    fireEvent.click(within(w).getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(mocks.updateCondominioRowAfectando).toHaveBeenLastCalledWith('notas_admin', 'n1', expect.objectContaining({ titulo: 'Reunión con el guardia', fecha_reunion: '2026-10-22' })))
  })

  it('imprimir abre la versión imprimible con participantes y compromisos', () => {
    const write = vi.fn(); const print = vi.fn()
    const open = vi.spyOn(window, 'open').mockReturnValue({ document: { write, close: vi.fn() }, print } as unknown as Window)
    render(<NotasAdminTab {...props()} />)
    fireEvent.click(screen.getByText('Reunión con el guardia'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '🖨 Imprimir' }))
    expect(open).toHaveBeenCalled()
    const html = write.mock.calls[0][0] as string
    expect(html).toContain('Reunión con el guardia')
    expect(html).toContain('Carlos Guardia')
    expect(html).toContain('Registrar cada ronda')
    expect(html).toContain('Responsable: Carlos Guardia')
    expect(print).toHaveBeenCalled()
    open.mockRestore()
  })
})

describe('Minutas — fotos y documentos', () => {
  /** Llega al paso 3 de una minuta nueva con un punto (el mínimo para guardar). */
  function nuevaHastaPaso3() {
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva minuta' }))
    const d = dialogo()
    fireEvent.change(within(d).getByLabelText('Título de la minuta *'), { target: { value: 'Con archivos' } })
    fireEvent.click(within(d).getByRole('button', { name: 'Siguiente →' }))
    fireEvent.click(within(d).getByRole('button', { name: '+ Agregar punto' }))
    fireEvent.change(within(d).getByLabelText('Punto 1'), { target: { value: 'Revisión en sitio' } })
    fireEvent.click(within(d).getByRole('tab', { name: 'Paso 3 · Acuerdos' }))
    return d
  }
  /** Abre la edición de `n` y va al paso 3. */
  function editarHastaPaso3(n: NotaAdmin) {
    render(<NotasAdminTab {...props({ notas: [n] })} />)
    fireEvent.click(screen.getByText(n.titulo))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '✏️ Editar' }))
    const w = screen.getByRole('dialog', { name: '✏️ Editar minuta' })
    fireEvent.click(within(w).getByRole('tab', { name: 'Paso 3 · Acuerdos' }))
    return w
  }
  const DOC = 'p1/minutas/1785540000000-ab12cd-acta.pdf'

  it('las fotos y los documentos subidos en el paso 3 se guardan con la minuta; los uploaders no borran al quitar', async () => {
    render(<NotasAdminTab {...props()} />)
    const d = nuevaHastaPaso3()
    expect(within(d).getByText('Fotos y documentos')).toBeTruthy()
    expect(mocks.borrarAlQuitar.every(v => v === false)).toBe(true)
    fireEvent.click(within(d).getByRole('button', { name: 'Simular subida' }))
    fireEvent.click(within(d).getByRole('button', { name: 'Simular subida de documento' }))
    expect(within(d).getByTestId('fotos-borrador').textContent).toBe('p1/minutas/nueva.jpg')
    expect(within(d).getByTestId('documentos-borrador').textContent).toBe(DOC)
    fireEvent.click(within(d).getByRole('button', { name: '✅ Guardar minuta' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [, payload] = mocks.createCondominioRow.mock.calls[0] as [string, Record<string, unknown>]
    expect(payload.fotos).toEqual(['p1/minutas/nueva.jpg'])
    expect(payload.documentos).toEqual([DOC])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocks.removeMedia).not.toHaveBeenCalled()
  })

  it('lo subido y quitado antes de guardar se borra al guardar; lo guardado no', async () => {
    render(<NotasAdminTab {...props()} />)
    const d = nuevaHastaPaso3()
    fireEvent.click(within(d).getByRole('button', { name: 'Simular subida' }))
    fireEvent.click(within(d).getByRole('button', { name: 'Simular quitar primera' }))
    fireEvent.click(within(d).getByRole('button', { name: 'Simular subida de documento' }))
    fireEvent.click(within(d).getByRole('button', { name: '✅ Guardar minuta' }))
    await waitFor(() => expect(mocks.removeMedia).toHaveBeenCalledWith('condominios-media', ['p1/minutas/nueva.jpg']))
    const [, payload] = mocks.createCondominioRow.mock.calls[0] as [string, Record<string, unknown>]
    expect(payload.fotos).toEqual([])
    expect(payload.documentos).toEqual([DOC])
  })

  it('cancelar borra del bucket las fotos y documentos subidos, también los que ya se habían quitado', () => {
    render(<NotasAdminTab {...props()} />)
    const d = nuevaHastaPaso3()
    fireEvent.click(within(d).getByRole('button', { name: 'Simular subida' }))
    fireEvent.click(within(d).getByRole('button', { name: 'Simular subida de documento' }))
    fireEvent.click(within(d).getByRole('button', { name: 'Simular quitar primer documento' }))
    fireEvent.click(within(d).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.removeMedia).toHaveBeenCalledTimes(1)
    expect(mocks.removeMedia).toHaveBeenCalledWith('condominios-media', ['p1/minutas/nueva.jpg', DOC])
  })

  it('una subida que termina con el asistente ya cerrado se borra al llegar', () => {
    render(<NotasAdminTab {...props()} />)
    nuevaHastaPaso3()
    const tarde = mocks.uploader.fotos
    fireEvent.click(within(dialogo()).getByRole('button', { name: 'Cancelar' }))
    expect(mocks.removeMedia).not.toHaveBeenCalled()
    tarde.onChange([...tarde.values, 'p1/minutas/tarde.jpg'])
    expect(mocks.removeMedia).toHaveBeenCalledWith('condominios-media', ['p1/minutas/tarde.jpg'])
  })

  it('mientras sube no se guarda, no se cierra ni se cambia de paso; los botones avisan sin salir del orden de Tab', async () => {
    render(<NotasAdminTab {...props()} />)
    const d = nuevaHastaPaso3()
    // Dos subidas: que termine una no basta.
    fireEvent.click(within(d).getByRole('button', { name: 'Simular inicio de subida' }))
    fireEvent.click(within(d).getByRole('button', { name: 'Simular inicio de subida' }))
    fireEvent.click(within(d).getByRole('button', { name: 'Simular fin de subida' }))
    const guardar = within(d).getByRole('button', { name: 'Subiendo archivos…' }) as HTMLButtonElement
    // aria-disabled y no `disabled`: un botón deshabilitado sale del orden de Tab y el foco se escapa.
    expect(guardar.disabled).toBe(false)
    expect(guardar.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(guardar)
    fireEvent.click(within(d).getByRole('button', { name: 'Cancelar' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(d).getByRole('button', { name: 'Cerrar modal' }))
    fireEvent.click(within(d).getByRole('button', { name: '← Anterior' }))
    fireEvent.click(within(d).getByRole('tab', { name: 'Paso 1 · Participantes' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(within(d).getByRole('tab', { name: 'Paso 3 · Acuerdos' }).getAttribute('aria-selected')).toBe('true')
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Subiendo archivos' }))

    fireEvent.click(within(d).getByRole('button', { name: 'Simular subida' }))
    fireEvent.click(within(d).getByRole('button', { name: 'Simular fin de subida' }))
    fireEvent.click(within(d).getByRole('button', { name: '✅ Guardar minuta' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
  })

  describe('si el asistente se desmonta mientras guarda («Atrás» del sistema)', () => {
    function guardadoPendiente(mock: typeof mocks.createCondominioRow) {
      let resolver!: (v: { error: { message: string } | null }) => void
      mock.mockImplementationOnce(() => new Promise(r => { resolver = r }))
      return (v: { error: { message: string } | null }) => resolver(v)
    }

    it('una minuta nueva guardada conserva sus archivos', async () => {
      const resolver = guardadoPendiente(mocks.createCondominioRow)
      const { unmount } = render(<NotasAdminTab {...props()} />)
      const d = nuevaHastaPaso3()
      fireEvent.click(within(d).getByRole('button', { name: 'Simular subida' }))
      fireEvent.click(within(d).getByRole('button', { name: 'Simular subida de documento' }))
      fireEvent.click(within(d).getByRole('button', { name: '✅ Guardar minuta' }))
      await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
      unmount()
      expect(mocks.removeMedia).not.toHaveBeenCalled()
      await act(async () => { resolver({ error: null }) })
      expect(mocks.removeMedia).not.toHaveBeenCalled()
    })

    it('una edición guardada borra sólo lo quitado; si el guardado falla, borra sólo lo subido', async () => {
      const resolver = guardadoPendiente(mocks.updateCondominioRowAfectando)
      const w = editarHastaPaso3({ ...abierta, fotos: ['p1/minutas/a.jpg', 'p1/minutas/b.jpg'] })
      fireEvent.click(within(w).getByRole('button', { name: 'Simular quitar primera' }))
      fireEvent.click(within(w).getByRole('button', { name: 'Simular subida' }))
      fireEvent.click(within(w).getByRole('button', { name: 'Guardar cambios' }))
      await waitFor(() => expect(mocks.updateCondominioRowAfectando).toHaveBeenCalledTimes(1))
      cleanup()
      expect(mocks.removeMedia).not.toHaveBeenCalled()
      await act(async () => { resolver({ error: null }) })
      expect(mocks.removeMedia).toHaveBeenCalledTimes(1)
      expect(mocks.removeMedia).toHaveBeenCalledWith('condominios-media', ['p1/minutas/a.jpg'])

      mocks.removeMedia.mockClear()
      const falla = guardadoPendiente(mocks.updateCondominioRowAfectando)
      const w2 = editarHastaPaso3({ ...abierta, fotos: ['p1/minutas/a.jpg'] })
      fireEvent.click(within(w2).getByRole('button', { name: 'Simular subida' }))
      fireEvent.click(within(w2).getByRole('button', { name: 'Guardar cambios' }))
      await waitFor(() => expect(mocks.updateCondominioRowAfectando).toHaveBeenCalledTimes(2))
      cleanup()
      await act(async () => { falla({ error: { message: 'sin conexión' } }) })
      expect(mocks.removeMedia).toHaveBeenCalledWith('condominios-media', ['p1/minutas/nueva.jpg'])
    })
  })

  it('al editar, lo guardado que se quita sólo se borra al guardar, y sólo viaja la lista que cambió', async () => {
    const conArchivos = { ...abierta, fotos: ['p1/minutas/a.jpg', 'p1/minutas/b.jpg'], documentos: ['p1/minutas/acta.pdf'] }
    const w = editarHastaPaso3(conArchivos)
    fireEvent.click(within(w).getByRole('button', { name: 'Simular quitar primera' }))
    expect(mocks.removeMedia).not.toHaveBeenCalled()
    fireEvent.click(within(w).getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(mocks.updateCondominioRowAfectando).toHaveBeenCalledTimes(1))
    const [, id, patch] = mocks.updateCondominioRowAfectando.mock.calls[0] as [string, string, Record<string, unknown>]
    expect(id).toBe('n1')
    expect(patch.fotos).toEqual(['p1/minutas/b.jpg'])
    // Los documentos no cambiaron: no se reescriben con la lista cargada al abrir.
    expect('documentos' in patch).toBe(false)
    await waitFor(() => expect(mocks.removeMedia).toHaveBeenCalledWith('condominios-media', ['p1/minutas/a.jpg']))
  })

  it('al editar sin tocar archivos no se reescriben las listas', async () => {
    const w = editarHastaPaso3({ ...abierta, fotos: ['p1/minutas/a.jpg'], documentos: ['p1/minutas/acta.pdf'] })
    fireEvent.click(within(w).getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(mocks.updateCondominioRowAfectando).toHaveBeenCalledTimes(1))
    const patch = mocks.updateCondominioRowAfectando.mock.calls[0][2] as Record<string, unknown>
    expect('fotos' in patch || 'documentos' in patch).toBe(false)
    expect(mocks.removeMedia).not.toHaveBeenCalled()
  })

  it('si la fila no se actualizó (política de filas), no se borra nada y la ventana sigue abierta', async () => {
    mocks.updateCondominioRowAfectando.mockResolvedValueOnce({ error: { message: 'No se modificó ninguna fila' } })
    const w = editarHastaPaso3({ ...abierta, fotos: ['p1/minutas/a.jpg'] })
    fireEvent.click(within(w).getByRole('button', { name: 'Simular quitar primera' }))
    fireEvent.click(within(w).getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', title: 'No se pudo guardar la minuta' })))
    expect(screen.getByRole('dialog', { name: '✏️ Editar minuta' })).toBeTruthy()
    expect(mocks.removeMedia).not.toHaveBeenCalled()
  })

  it('al editar y cancelar, lo guardado que se quitó no se borra; lo subido sí', () => {
    const w = editarHastaPaso3({ ...abierta, fotos: ['p1/minutas/a.jpg'], documentos: ['p1/minutas/acta.pdf'] })
    fireEvent.click(within(w).getByRole('button', { name: 'Simular quitar primera' }))
    fireEvent.click(within(w).getByRole('button', { name: 'Simular quitar primer documento' }))
    fireEvent.click(within(w).getByRole('button', { name: 'Simular subida de documento' }))
    fireEvent.click(within(w).getByRole('button', { name: 'Cancelar' }))
    expect(mocks.removeMedia).toHaveBeenCalledTimes(1)
    expect(mocks.removeMedia).toHaveBeenCalledWith('condominios-media', [DOC])
  })

  it('el detalle muestra fotos y documentos, la tarjeta los cuenta y la impresión nombra los documentos', () => {
    const conArchivos = { ...abierta, fotos: ['p1/minutas/a.jpg', 'p1/minutas/b.jpg'], documentos: [DOC, 'p1/minutas/cotizacion.xlsx'] }
    render(<NotasAdminTab {...props({ notas: [conArchivos] })} />)
    const tarjeta = screen.getByText('Reunión con el guardia').closest('button')!
    expect(tarjeta.textContent).toContain('📷 2')
    expect(tarjeta.textContent).toContain('📎 2')
    fireEvent.click(screen.getByText('Reunión con el guardia'))
    const d = screen.getByRole('dialog', { name: 'Reunión con el guardia' })
    expect(within(d).getByText('Fotos (2)')).toBeTruthy()
    expect(within(d).getByTestId('galeria').textContent).toBe('p1/minutas/a.jpg|p1/minutas/b.jpg')
    expect(within(d).getByText('Documentos (2)')).toBeTruthy()
    expect(within(d).getByTestId('adjuntos').textContent).toBe(`${DOC}|p1/minutas/cotizacion.xlsx`)

    const write = vi.fn()
    const open = vi.spyOn(window, 'open').mockReturnValue({ document: { write, close: vi.fn() }, print: vi.fn() } as unknown as Window)
    fireEvent.click(within(d).getByRole('button', { name: '🖨 Imprimir' }))
    expect(write.mock.calls[0][0]).toContain('Documentos adjuntos:</strong> acta.pdf, cotizacion.xlsx')
    open.mockRestore()
  })

  it('sin archivos no hay secciones de fotos ni de documentos en el detalle', () => {
    render(<NotasAdminTab {...props()} />)
    fireEvent.click(screen.getByText('Reunión con el guardia'))
    expect(within(screen.getByRole('dialog')).queryByText(/^Fotos \(/)).toBeNull()
    expect(within(screen.getByRole('dialog')).queryByText(/^Documentos \(/)).toBeNull()
  })

  it('eliminar la minuta borra sus fotos y documentos; si la fila no se borró, no toca los archivos', async () => {
    const conArchivos = { ...abierta, fotos: ['p1/minutas/a.jpg'], documentos: [DOC] }
    const { unmount } = render(<NotasAdminTab {...props({ notas: [conArchivos] })} />)
    fireEvent.click(screen.getByText('Reunión con el guardia'))
    mocks.deleteCondominioRowAfectando.mockResolvedValueOnce({ error: { message: 'No se modificó ninguna fila' } })
    fireEvent.click(within(dialogo()).getByRole('button', { name: '🗑 Eliminar' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'No se pudo eliminar' })))
    expect(mocks.removeMedia).not.toHaveBeenCalled()

    fireEvent.click(within(dialogo()).getByRole('button', { name: '🗑 Eliminar' }))
    await waitFor(() => expect(mocks.removeMedia).toHaveBeenCalledWith('condominios-media', ['p1/minutas/a.jpg', DOC]))
    expect(mocks.deleteCondominioRowAfectando).toHaveBeenLastCalledWith('notas_admin', 'n1')
    unmount()
  })
})
