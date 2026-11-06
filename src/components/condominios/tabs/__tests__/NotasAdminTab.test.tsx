// Minutas: la lista resume abiertas, compromisos pendientes y vencidos; la
// nueva minuta va en ventana y en tres pasos —participantes (empleado,
// propietario/inquilino, proveedor u otro, con quien gestiona), puntos y
// acuerdos/compromisos por punto—; el detalle marca compromisos cumplidos,
// cierra la minuta y abre la edición con lo guardado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import type { ContratoArrendamiento, ContratoProveedor, NotaAdmin, PersonalCondominio, Unidad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRowReturning: vi.fn(async (..._args: unknown[]) => ({ data: { id: 'nueva-1' } as Record<string, unknown> | null, error: null as { message: string } | null })),
  updateCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  updateCondominioRowAfectando: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  deleteCondominioRowAfectando: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  removeMedia: vi.fn(async (_bucket: string, _paths: string[]) => ({ error: null as string | null })),
  uploadCondominiosMedia: vi.fn(async (path: string, _file: File, _o?: unknown) => ({ data: { path } as { path: string } | null, error: null as string | null })),
  downloadMedia: vi.fn(async (_bucket: string, _path: string) => null as Blob | null),
  registrarFirmaMinuta: vi.fn(async (_id: string, _firma: unknown) => ({ error: null as string | null, reemplazada: null as string | null })),
  leerFirmasMinuta: vi.fn(async (_id: string) => null as unknown[] | null),
  borrarAlQuitar: [] as (boolean | undefined)[],
  /** Últimas props de cada uploader: para simular una subida que termina tarde. */
  uploader: {} as Record<'fotos' | 'documentos', { values: string[]; onChange: (v: string[]) => void }>,
  fetchResidentesProyecto: vi.fn(async (_projectId: string) => [
    { id: 'r1', unidad_id: 'u2', cliente_id: 'c1', tipo: 'propietario', nombre: 'María Pérez', unidad_nombre: 'Casa 2' },
  ]),
  fetchEquipoProyecto: vi.fn(async (_projectId: string) => ({ data: [] as { id: string; full_name: string; role: string }[], error: null as string | null })),
  useProveedoresQuery: vi.fn(() => ({ data: [{ id: 'v1', company_id: 'co1', nombre: 'Limpiezas SA', activo: true, contacto_nombre: 'Rosa' }], isLoading: false })),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRowReturning: mocks.createCondominioRowReturning,
  updateCondominioRow: mocks.updateCondominioRow,
  updateCondominioRowAfectando: mocks.updateCondominioRowAfectando,
  deleteCondominioRowAfectando: mocks.deleteCondominioRowAfectando,
}))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify, confirm: mocks.confirm }))
vi.mock('../../../../domain/cxp/queries', () => ({ useProveedoresQuery: mocks.useProveedoresQuery }))
vi.mock('../../../../domain/shared/storage', () => ({
  removeMedia: mocks.removeMedia,
  uploadCondominiosMedia: mocks.uploadCondominiosMedia,
  downloadMedia: mocks.downloadMedia,
}))
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
  fetchEquipoProyecto: mocks.fetchEquipoProyecto,
  registrarFirmaMinuta: mocks.registrarFirmaMinuta,
  leerFirmasMinuta: mocks.leerFirmasMinuta,
}))
// El recuadro real dibuja en un <canvas>; aquí basta con que entregue un PNG,
// y respete el bloqueo mientras no se acepte la declaración.
vi.mock('../../../shared/SignaturePad', () => ({
  SignaturePad: (p: { onSave: (f: File) => void; bloquearGuardar?: boolean; saving?: boolean }) => (
    <button type="button" disabled={p.bloquearGuardar || p.saving} onClick={() => p.onSave(new File(['png'], 'firma.png', { type: 'image/png' }))}>Simular firma</button>
  ),
}))
vi.mock('../../../shared/SecureImage', () => ({ SecureImage: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} data-src={src} /> }))

const { default: NotasAdminTab } = await import('../NotasAdminTab')
const { versionAcuerdos, participantesDe, puntosDe } = await import('../../../../domain/condominios/minutas')

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
/** Cuentas de la empresa con acceso al proyecto; quien registra (Admin, uB) es una de ellas. */
const EQUIPO = [{ id: 'uA', full_name: 'Lucía Admin', role: 'admin' }, { id: 'uB', full_name: 'Admin', role: 'company_owner' }]

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
    notas: [abierta, cerrada], proyectoId: 'p1', companyId: 'co1', autorNombre: 'Admin', autorId: 'uB', autorRol: 'company_owner',
    personal, unidades, contratos, contratosProveedores, canCreate: true, canEdit: true, canDelete: true, onRefresh: vi.fn(), ...over,
  }
}

const dialogo = () => screen.getByRole('dialog')
/** window.open simulado: la impresión escribe un aviso, baja las firmas y luego escribe la minuta. */
function ventanaDeImpresion() {
  const write = vi.fn(); const print = vi.fn()
  const ventana = { closed: false, document: { write, open: vi.fn(), close: vi.fn() }, print }
  const open = vi.spyOn(window, 'open').mockReturnValue(ventana as unknown as Window)
  return { ventana, write, print, open }
}
/** Una minuta nueva se guarda en el paso 4 (Firmas, que es opcional). */
function guardarNueva(d: HTMLElement) {
  fireEvent.click(within(d).getByRole('tab', { name: 'Paso 4 · Firmas' }))
  fireEvent.click(within(d).getByRole('button', { name: '✅ Guardar minuta' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.borrarAlQuitar.length = 0
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 26, 12, 0, 0)) // 26 oct 2026
  mocks.createCondominioRowReturning.mockResolvedValue({ data: { id: 'nueva-1' }, error: null })
  mocks.fetchEquipoProyecto.mockResolvedValue({ data: EQUIPO, error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRowAfectando.mockResolvedValue({ error: null })
  mocks.deleteCondominioRowAfectando.mockResolvedValue({ error: null })
  mocks.registrarFirmaMinuta.mockResolvedValue({ error: null, reemplazada: null })
  mocks.leerFirmasMinuta.mockResolvedValue(null)
  mocks.downloadMedia.mockResolvedValue(null)
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
    expect(within(d).getByText(/Paso 1 de 4/)).toBeTruthy()

    // Quien la crea ya está como gestor, como miembro del equipo del proyecto (con su rol)
    expect(within(d).getByText('★ Gestiona')).toBeTruthy()
    expect(within(d).getByText('Admin Empresa')).toBeTruthy()

    // Equipo del proyecto: la lista por defecto; quien registra ya figura como agregado
    expect(within(d).getByRole('radio', { name: /Equipo del proyecto/ }).getAttribute('aria-checked')).toBe('true')
    expect(await within(d).findByRole('button', { name: 'Admin ya está en la minuta' })).toBeTruthy()
    expect(within(d).getByText('Administrador')).toBeTruthy() // el rol de Lucía
    fireEvent.click(within(d).getByRole('button', { name: 'Agregar a Lucía Admin' }))
    expect(within(d).getByRole('button', { name: 'Lucía Admin ya está en la minuta' })).toBeTruthy()

    // Sin título no se avanza
    fireEvent.click(within(d).getByRole('button', { name: 'Siguiente →' }))
    expect(mocks.notify).toHaveBeenLastCalledWith(expect.objectContaining({ variant: 'warning', text: expect.stringMatching(/título/) }))
    expect(within(d).getByText(/Paso 1 de 4/)).toBeTruthy()

    fireEvent.change(within(d).getByLabelText('Título de la minuta *'), { target: { value: 'Turno nocturno' } })
    expect((within(d).getByLabelText('Fecha de la reunión *') as HTMLInputElement).value).toBe('2026-10-26')

    // Empleado (el inactivo no aparece)
    fireEvent.click(within(d).getByRole('radio', { name: /Empleado/ }))
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
    expect(within(d).getByText('Participantes (6)')).toBeTruthy()

    // Cambiar quien gestiona y quitar a uno
    fireEvent.click(within(d).getAllByRole('button', { name: 'Hacer gestor' })[1]) // Carlos (el [0] es Lucía)
    const tarjetaCarlos = within(d).getByText('Carlos Guardia').closest('div')!.parentElement!
    expect(tarjetaCarlos.textContent).toContain('★ Gestiona')
    fireEvent.click(within(d).getByRole('button', { name: 'Quitar a Lic. Rodríguez' }))
    expect(within(d).getByText('Participantes (5)')).toBeTruthy()

    // Paso 2: puntos
    fireEvent.click(within(d).getByRole('button', { name: 'Siguiente →' }))
    expect(within(d).getByText(/Paso 2 de 4/)).toBeTruthy()
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
    expect(within(d).getByText(/Paso 3 de 4/)).toBeTruthy()
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

    guardarNueva(d)
    await waitFor(() => expect(mocks.createCondominioRowReturning).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRowReturning.mock.calls[0] as [string, Record<string, unknown>]
    expect(tabla).toBe('notas_admin')
    expect(payload).toMatchObject({
      company_id: 'co1', project_id: 'p1', autor: 'Admin', titulo: 'Turno nocturno', fecha_reunion: '2026-10-26',
      categoria: 'reunion', prioridad: 'alta', fecha_recordatorio: '2026-11-03', fijada: false, contenido: '', borrador_paso: null,
    })
    const participantes = payload.participantes as { tipo: string; nombre: string; gestiona: boolean; ref_id: string | null; detalle: string | null }[]
    expect(participantes.map(p => [p.tipo, p.nombre, p.gestiona])).toEqual([
      ['equipo', 'Admin', false], ['equipo', 'Lucía Admin', false], ['empleado', 'Carlos Guardia', true], ['residente', 'María Pérez', false], ['proveedor', 'Limpiezas SA', false],
    ])
    expect(participantes[0]).toMatchObject({ ref_id: 'uB', detalle: 'Admin Empresa' })
    expect(participantes[1]).toMatchObject({ ref_id: 'uA', detalle: 'Administrador' })
    expect(participantes[2]).toMatchObject({ ref_id: 'e1', detalle: 'Guardia' })
    expect(participantes[3]).toMatchObject({ ref_id: 'r1', detalle: 'Casa 2 · Propietario' })
    expect(participantes[4]).toMatchObject({ ref_id: 'v1', detalle: 'Rosa' })
    const puntos = payload.puntos as { titulo: string; descripcion: string | null; acuerdos: Record<string, unknown>[] }[]
    expect(puntos).toHaveLength(1)
    expect(puntos[0]).toMatchObject({ titulo: 'Rondas nocturnas', descripcion: 'Faltan las de madrugada' })
    expect(puntos[0].acuerdos[0]).toMatchObject({ tipo: 'acuerdo', texto: 'Se mantiene el horario', responsable_id: null, fecha_limite: null, cumplido: false })
    expect(puntos[0].acuerdos[1]).toMatchObject({ tipo: 'compromiso', texto: 'Registrar cada ronda', responsable_id: (payload.participantes as { id: string }[])[2].id, fecha_limite: '2026-11-02', cumplido: false })
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('con el catálogo de cargos el empleado muestra el nombre del cargo; el error al guardar no cierra la ventana', async () => {
    mocks.createCondominioRowReturning.mockResolvedValueOnce({ data: null, error: { message: 'sin permiso' } })
    render(<NotasAdminTab {...props({ cargos: [{ id: 'g', company_id: 'co1', project_id: 'p1', codigo: 'guardia', nombre: 'Guardia de seguridad', icono: '', orden: 1 } as never] })} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva minuta' }))
    const d = dialogo()
    fireEvent.click(within(d).getByRole('radio', { name: /Empleado/ }))
    expect(within(d).getByText('Guardia de seguridad')).toBeTruthy()
    fireEvent.change(within(d).getByLabelText('Título de la minuta *'), { target: { value: 'Prueba' } })
    fireEvent.click(within(d).getByRole('button', { name: 'Siguiente →' }))
    fireEvent.click(within(d).getByRole('button', { name: '+ Agregar punto' }))
    fireEvent.change(within(d).getByLabelText('Punto 1'), { target: { value: 'Tema' } })
    // Saltar al paso 3 desde el indicador
    fireEvent.click(within(d).getByRole('tab', { name: 'Paso 3 · Acuerdos' }))
    guardarNueva(d)
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

  it('imprimir abre la versión imprimible con participantes y compromisos', async () => {
    const { ventana, write, print, open } = ventanaDeImpresion()
    render(<NotasAdminTab {...props()} />)
    fireEvent.click(screen.getByText('Reunión con el guardia'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '🖨 Imprimir' }))
    expect(open).toHaveBeenCalled()
    await waitFor(() => expect(print).toHaveBeenCalled())
    void ventana
    const html = write.mock.calls.at(-1)![0] as string
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
    guardarNueva(d)
    await waitFor(() => expect(mocks.createCondominioRowReturning).toHaveBeenCalledTimes(1))
    const [, payload] = mocks.createCondominioRowReturning.mock.calls[0] as [string, Record<string, unknown>]
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
    guardarNueva(d)
    await waitFor(() => expect(mocks.removeMedia).toHaveBeenCalledWith('condominios-media', ['p1/minutas/nueva.jpg']))
    const [, payload] = mocks.createCondominioRowReturning.mock.calls[0] as [string, Record<string, unknown>]
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
    fireEvent.click(within(d).getByRole('button', { name: 'Siguiente →' }))
    fireEvent.click(within(d).getByRole('tab', { name: 'Paso 4 · Firmas' }))
    fireEvent.click(within(d).getByRole('button', { name: 'Cancelar' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(d).getByRole('button', { name: 'Cerrar modal' }))
    fireEvent.click(within(d).getByRole('button', { name: '← Anterior' }))
    fireEvent.click(within(d).getByRole('tab', { name: 'Paso 1 · Participantes' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(within(d).getByRole('tab', { name: 'Paso 3 · Acuerdos' }).getAttribute('aria-selected')).toBe('true')
    expect(mocks.createCondominioRowReturning).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Subiendo archivos' }))

    fireEvent.click(within(d).getByRole('button', { name: 'Simular subida' }))
    fireEvent.click(within(d).getByRole('button', { name: 'Simular fin de subida' }))
    guardarNueva(d)
    await waitFor(() => expect(mocks.createCondominioRowReturning).toHaveBeenCalledTimes(1))
  })

  it('al editar, «Guardar cambios» avisa durante la subida sin salir del orden de Tab', () => {
    const w = editarHastaPaso3({ ...abierta })
    fireEvent.click(within(w).getByRole('button', { name: 'Simular inicio de subida' }))
    const guardar = within(w).getByRole('button', { name: 'Subiendo archivos…' }) as HTMLButtonElement
    // aria-disabled y no `disabled`: un botón deshabilitado sale del orden de Tab y el foco se escapa.
    expect(guardar.disabled).toBe(false)
    expect(guardar.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(guardar)
    expect(mocks.updateCondominioRowAfectando).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Subiendo archivos' }))
  })

  describe('si el asistente se desmonta mientras guarda («Atrás» del sistema)', () => {
    function guardadoPendiente<T>(mock: { mockImplementationOnce: (f: () => Promise<T>) => unknown }) {
      let resolver!: (v: T) => void
      mock.mockImplementationOnce(() => new Promise<T>(r => { resolver = r }))
      return (v: T) => resolver(v)
    }

    it('una minuta nueva guardada conserva sus archivos', async () => {
      const resolver = guardadoPendiente(mocks.createCondominioRowReturning)
      const { unmount } = render(<NotasAdminTab {...props()} />)
      const d = nuevaHastaPaso3()
      fireEvent.click(within(d).getByRole('button', { name: 'Simular subida' }))
      fireEvent.click(within(d).getByRole('button', { name: 'Simular subida de documento' }))
      guardarNueva(d)
      await waitFor(() => expect(mocks.createCondominioRowReturning).toHaveBeenCalledTimes(1))
      unmount()
      expect(mocks.removeMedia).not.toHaveBeenCalled()
      await act(async () => { resolver({ data: { id: 'nueva-1' }, error: null }) })
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

  it('el detalle muestra fotos y documentos, la tarjeta los cuenta y la impresión nombra los documentos', async () => {
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

    const { write, print, open } = ventanaDeImpresion()
    fireEvent.click(within(d).getByRole('button', { name: '🖨 Imprimir' }))
    await waitFor(() => expect(print).toHaveBeenCalled())
    expect(write.mock.calls.at(-1)![0]).toContain('Documentos adjuntos:</strong> acta.pdf, cotizacion.xlsx')
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

describe('Minutas — firmas', () => {
  const FIRMA = /^p1\/minutas-firmas\//
  /** La firma vigente de `quien` sobre la versión actual de `n`. */
  const firmaDe = (n: NotaAdmin, quien: string, path = `p1/minutas-firmas/${quien}.png`) => ({
    participante_id: quien, nombre: participantesDe(n).find(p => p.id === quien)!.nombre, path,
    firmado_at: '2026-10-22T18:00:00.000Z', version: versionAcuerdos(puntosDe(n), participantesDe(n)),
  })
  function nuevaHastaFirmas() {
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva minuta' }))
    const d = dialogo()
    fireEvent.change(within(d).getByLabelText('Título de la minuta *'), { target: { value: 'Entrega de unidad' } })
    fireEvent.click(within(d).getByRole('button', { name: 'Siguiente →' }))
    fireEvent.click(within(d).getByRole('button', { name: '+ Agregar punto' }))
    fireEvent.change(within(d).getByLabelText('Punto 1'), { target: { value: 'Entrega de accesos' } })
    fireEvent.click(within(d).getByRole('tab', { name: 'Paso 3 · Acuerdos' }))
    fireEvent.click(within(d).getByRole('button', { name: 'Agregar acuerdo al punto 1' }))
    fireEvent.change(within(d).getByLabelText('Acuerdo del punto 1'), { target: { value: 'Todo funciona' } })
    fireEvent.click(within(d).getByRole('tab', { name: 'Paso 4 · Firmas' }))
    return d
  }
  async function firmarComo(nombre: string) {
    fireEvent.click(screen.getByRole('button', { name: `Firmar: ${nombre}` }))
    const m = screen.getByRole('dialog', { name: `✍ Firma de ${nombre}` })
    // Sin aceptar la declaración no se puede firmar.
    expect((within(m).getByRole('button', { name: 'Simular firma' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(m).getByLabelText(new RegExp(`acepto los acuerdos y compromisos`, 'i')))
    fireEvent.click(within(m).getByRole('button', { name: 'Simular firma' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: `✍ Firma de ${nombre}` })).toBeNull())
  }

  it('el paso 4 muestra lo que se firma; quien firma acepta la declaración y la firma se guarda con la versión de los acuerdos', async () => {
    render(<NotasAdminTab {...props()} />)
    const d = nuevaHastaFirmas()
    expect(within(d).getByText(/Paso 4 de 4/)).toBeTruthy()
    expect(within(d).getByText('Lo que se firma')).toBeTruthy()
    expect(within(d).getByText('Todo funciona')).toBeTruthy()
    expect(within(d).getByText('Firmas (0 de 1)')).toBeTruthy()
    expect(within(d).getByText('Pendiente de firma')).toBeTruthy()

    await firmarComo('Admin')
    const path = mocks.uploadCondominiosMedia.mock.calls[0][0]
    expect(path).toMatch(FIRMA)
    expect(within(d).getByText('Firmas (1 de 1)')).toBeTruthy()
    expect(within(d).getByText(/^✍ Firmó/)).toBeTruthy()
    expect(within(d).getByRole('img', { name: 'Firma de Admin' }).getAttribute('data-src')).toBe(path)

    fireEvent.click(within(d).getByRole('button', { name: '✅ Guardar minuta' }))
    await waitFor(() => expect(mocks.createCondominioRowReturning).toHaveBeenCalledTimes(1))
    const payload = mocks.createCondominioRowReturning.mock.calls[0][1] as { firmas: { participante_id: string; nombre: string; path: string; version: string; firmado_at: string }[]; puntos: never; participantes: never }
    expect(payload.firmas).toHaveLength(1)
    expect(payload.firmas[0]).toMatchObject({ nombre: 'Admin', path })
    expect(payload.firmas[0].firmado_at).toMatch(/^2026-10-26T/)
    // La versión firmada es la de lo que se guardó.
    expect(payload.firmas[0].version).toBe(versionAcuerdos(puntosDe({ puntos: payload.puntos }), participantesDe({ participantes: payload.participantes })))
    expect(mocks.removeMedia).not.toHaveBeenCalled()
  })

  it('cancelar borra la firma subida; volver a firmar deja sólo la última', async () => {
    render(<NotasAdminTab {...props()} />)
    nuevaHastaFirmas()
    await firmarComo('Admin')
    fireEvent.click(screen.getByRole('button', { name: 'Volver a firmar: Admin' }))
    const m = screen.getByRole('dialog', { name: '✍ Firma de Admin' })
    fireEvent.click(within(m).getByLabelText(/acepto los acuerdos/i))
    fireEvent.click(within(m).getByRole('button', { name: 'Simular firma' }))
    await waitFor(() => expect(mocks.uploadCondominiosMedia).toHaveBeenCalledTimes(2))
    const subidas = mocks.uploadCondominiosMedia.mock.calls.map(c => c[0] as string)
    fireEvent.click(within(screen.getByRole('dialog', { name: '📝 Nueva minuta' })).getByRole('button', { name: 'Cancelar' }))
    expect(mocks.removeMedia).toHaveBeenCalledWith('condominios-media', subidas)
  })

  it('al editar: cambiar un acuerdo firmado deja la firma como de una versión anterior, y quitar al participante descarta su firma', async () => {
    const conFirmas = { ...abierta, firmas: [firmaDe(abierta, 'pa'), firmaDe(abierta, 'pb')] }
    render(<NotasAdminTab {...props({ notas: [conFirmas] })} />)
    fireEvent.click(screen.getByText('Reunión con el guardia'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '✏️ Editar' }))
    const w = screen.getByRole('dialog', { name: '✏️ Editar minuta' })
    fireEvent.click(within(w).getByRole('tab', { name: 'Paso 4 · Firmas' }))
    expect(within(w).getByText('Firmas (2 de 2)')).toBeTruthy()

    fireEvent.click(within(w).getByRole('tab', { name: 'Paso 3 · Acuerdos' }))
    expect(within(w).getByRole('note').textContent).toMatch(/ya tiene firmas/)
    fireEvent.change(within(w).getAllByLabelText(/^Compromiso del punto/, { selector: 'input' })[0], { target: { value: 'Registrar cada ronda en la bitácora' } })
    fireEvent.click(within(w).getByRole('tab', { name: 'Paso 4 · Firmas' }))
    expect(within(w).getByText('Firmas (0 de 2)')).toBeTruthy()
    expect(within(w).getAllByText(/Firmó una versión anterior/)).toHaveLength(2)
    expect(within(w).getByText(/2 firmas son de una versión anterior de los acuerdos/)).toBeTruthy()

    // Quitar a Carlos: su firma no se guarda y su imagen se borra al guardar.
    fireEvent.click(within(w).getByRole('tab', { name: 'Paso 1 · Participantes' }))
    fireEvent.click(within(w).getByRole('button', { name: 'Quitar a Carlos Guardia' }))
    fireEvent.click(within(w).getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(mocks.updateCondominioRowAfectando).toHaveBeenCalledTimes(1))
    const patch = mocks.updateCondominioRowAfectando.mock.calls[0][2] as { firmas: { participante_id: string }[] }
    expect(patch.firmas.map(f => f.participante_id)).toEqual(['pa'])
    await waitFor(() => expect(mocks.removeMedia).toHaveBeenCalledWith('condominios-media', ['p1/minutas-firmas/pb.png']))
  })

  it('el detalle muestra las firmas, firma quien falta y lo guarda en el acto; la tarjeta las cuenta', async () => {
    const onRefresh = vi.fn()
    const conFirma = { ...abierta, firmas: [firmaDe(abierta, 'pa')] }
    render(<NotasAdminTab {...props({ notas: [conFirma], onRefresh })} />)
    expect(screen.getByText('Reunión con el guardia').closest('button')!.textContent).toContain('✍ 1 de 2 firmas')
    fireEvent.click(screen.getByText('Reunión con el guardia'))
    const d = screen.getByRole('dialog', { name: 'Reunión con el guardia' })
    expect(within(d).getByText('Firmas (1 de 2)')).toBeTruthy()
    // Admin ya firmó: no se le ofrece firmar. Carlos sí.
    expect(within(d).queryByRole('button', { name: 'Firmar: Admin' })).toBeNull()
    await firmarComo('Carlos Guardia')
    await waitFor(() => expect(mocks.registrarFirmaMinuta).toHaveBeenCalledTimes(1))
    const [id, firma] = mocks.registrarFirmaMinuta.mock.calls[0] as [string, { participante_id: string; path: string; version: string }]
    expect(id).toBe('n1')
    expect(firma).toMatchObject({ participante_id: 'pb', nombre: 'Carlos Guardia', version: versionAcuerdos(puntosDe(abierta), participantesDe(abierta)) })
    expect(firma.path).toMatch(FIRMA)
    expect(onRefresh).toHaveBeenCalled()
    expect(mocks.removeMedia).not.toHaveBeenCalled()
  })

  it('en el detalle, si la firma no se pudo guardar, la imagen subida se borra; si reemplazó otra, la vieja también', async () => {
    const anterior = { ...firmaDe(abierta, 'pb'), version: 'otra-version' }
    render(<NotasAdminTab {...props({ notas: [{ ...abierta, firmas: [anterior] }] })} />)
    fireEvent.click(screen.getByText('Reunión con el guardia'))
    expect(within(dialogo()).getByText(/Firmó una versión anterior/)).toBeTruthy()

    mocks.registrarFirmaMinuta.mockResolvedValueOnce({ error: 'sin permiso', reemplazada: null })
    // El nombre accesible dice lo mismo que el botón: «Firmar de nuevo».
    fireEvent.click(screen.getByRole('button', { name: 'Firmar de nuevo: Carlos Guardia' }))
    let m = screen.getByRole('dialog', { name: '✍ Firma de Carlos Guardia' })
    fireEvent.click(within(m).getByLabelText(/acepto los acuerdos/i))
    fireEvent.click(within(m).getByRole('button', { name: 'Simular firma' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', title: 'No se pudo guardar la firma' })))
    const subida = mocks.uploadCondominiosMedia.mock.calls[0][0] as string
    expect(mocks.removeMedia).toHaveBeenCalledWith('condominios-media', [subida])
    // La ventana sigue abierta para reintentar.
    m = screen.getByRole('dialog', { name: '✍ Firma de Carlos Guardia' })

    mocks.removeMedia.mockClear()
    mocks.registrarFirmaMinuta.mockResolvedValueOnce({ error: null, reemplazada: anterior.path })
    fireEvent.click(within(m).getByRole('button', { name: 'Simular firma' }))
    await waitFor(() => expect(mocks.removeMedia).toHaveBeenCalledWith('condominios-media', [anterior.path]))
  })

  it('una minuta cerrada no ofrece firmar; cerrar avisa de las firmas pendientes; eliminar borra las firmas', async () => {
    render(<NotasAdminTab {...props({ notas: [{ ...abierta, firmas: [firmaDe(abierta, 'pa')] }, { ...cerrada }] })} />)
    fireEvent.click(screen.getByText('Reunión con el guardia'))
    fireEvent.click(within(dialogo()).getByRole('button', { name: '✓ Cerrar minuta' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    expect((mocks.confirm.mock.calls[0] as unknown as [{ text: string }])[0].text).toMatch(/1 firma pendiente/)

    fireEvent.click(within(dialogo()).getByRole('button', { name: '🗑 Eliminar' }))
    await waitFor(() => expect(mocks.removeMedia).toHaveBeenCalledWith('condominios-media', ['p1/minutas-firmas/pa.png']))
    cleanup()

    render(<NotasAdminTab {...props({ notas: [{ ...cerrada, firmas: [] }] })} />)
    fireEvent.click(screen.getByRole('radio', { name: /Cerradas/ }))
    fireEvent.click(screen.getByText('Reunión con jardinería'))
    expect(within(dialogo()).getByText('Firmas (0 de 1)')).toBeTruthy()
    expect(within(dialogo()).queryByRole('button', { name: /^Firmar:/ })).toBeNull()
  })

  it('al editar, guardar conserva la firma que otro registró desde el detalle mientras el asistente estaba abierto', async () => {
    const original = firmaDe(abierta, 'pa', 'p1/minutas-firmas/pa-vieja.png')
    const deOtroDispositivo = firmaDe(abierta, 'pb', 'p1/minutas-firmas/pb-detalle.png')
    // Al abrir sólo estaba la de Admin; cuando se guarda, la fila ya tiene también la de Carlos.
    mocks.leerFirmasMinuta.mockResolvedValue([original, deOtroDispositivo])
    render(<NotasAdminTab {...props({ notas: [{ ...abierta, firmas: [original] }] })} />)
    fireEvent.click(screen.getByText('Reunión con el guardia'))
    fireEvent.click(within(dialogo()).getByRole('button', { name: '✏️ Editar' }))
    const w = screen.getByRole('dialog', { name: '✏️ Editar minuta' })
    fireEvent.click(within(w).getByRole('tab', { name: 'Paso 4 · Firmas' }))
    // Admin vuelve a firmar en el asistente.
    fireEvent.click(within(w).getByRole('button', { name: 'Volver a firmar: Admin' }))
    const m = screen.getByRole('dialog', { name: '✍ Firma de Admin' })
    fireEvent.click(within(m).getByLabelText(/acepto los acuerdos/i))
    fireEvent.click(within(m).getByRole('button', { name: 'Simular firma' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '✍ Firma de Admin' })).toBeNull())
    const nueva = mocks.uploadCondominiosMedia.mock.calls[0][0]
    fireEvent.click(within(w).getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(mocks.updateCondominioRowAfectando).toHaveBeenCalledTimes(1))
    expect(mocks.leerFirmasMinuta).toHaveBeenCalledWith('n1')
    const patch = mocks.updateCondominioRowAfectando.mock.calls[0][2] as { firmas: { participante_id: string; path: string }[] }
    expect(patch.firmas.map(f => [f.participante_id, f.path])).toEqual([['pb', 'p1/minutas-firmas/pb-detalle.png'], ['pa', nueva]])
    // Se borra sólo la que esta edición reemplazó; la del otro dispositivo, no.
    await waitFor(() => expect(mocks.removeMedia).toHaveBeenCalledWith('condominios-media', ['p1/minutas-firmas/pa-vieja.png']))
    expect(mocks.removeMedia.mock.calls.flatMap(c => c[1] as string[])).not.toContain('p1/minutas-firmas/pb-detalle.png')
  })

  it('en el paso 4, quitar una firma deja el foco en el botón «Firmar» de esa fila', () => {
    render(<NotasAdminTab {...props({ notas: [{ ...abierta, firmas: [firmaDe(abierta, 'pa')] }] })} />)
    fireEvent.click(screen.getByText('Reunión con el guardia'))
    fireEvent.click(within(dialogo()).getByRole('button', { name: '✏️ Editar' }))
    const w = screen.getByRole('dialog', { name: '✏️ Editar minuta' })
    fireEvent.click(within(w).getByRole('tab', { name: 'Paso 4 · Firmas' }))
    fireEvent.click(within(w).getByRole('button', { name: 'Quitar la firma de Admin' }))
    expect(document.activeElement).toBe(within(w).getByRole('button', { name: 'Firmar: Admin' }))
  })

  it('en el detalle, dos toques seguidos en «Firmar y aceptar» suben una sola firma; luego el foco va al título de Firmas', async () => {
    render(<NotasAdminTab {...props()} />)
    fireEvent.click(screen.getByText('Reunión con el guardia'))
    fireEvent.click(screen.getByRole('button', { name: 'Firmar: Carlos Guardia' }))
    const m = screen.getByRole('dialog', { name: '✍ Firma de Carlos Guardia' })
    fireEvent.click(within(m).getByLabelText(/acepto los acuerdos/i))
    const firmarBtn = within(m).getByRole('button', { name: 'Simular firma' })
    fireEvent.click(firmarBtn)
    fireEvent.click(firmarBtn)
    await waitFor(() => expect(mocks.registrarFirmaMinuta).toHaveBeenCalledTimes(1))
    expect(mocks.uploadCondominiosMedia).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(document.activeElement?.textContent).toMatch(/^Firmas \(0 de 2\)/))
  })

  it('eliminar no borra rutas de fuera de la carpeta del proyecto aunque la fila las cite', async () => {
    const ajena = { ...firmaDe(abierta, 'pb'), path: 'otro-proyecto/minutas-firmas/x.png' }
    render(<NotasAdminTab {...props({ notas: [{ ...abierta, fotos: ['otro-proyecto/minutas/f.jpg', 'p1/minutas/a.jpg'], firmas: [firmaDe(abierta, 'pa'), ajena] }] })} />)
    fireEvent.click(screen.getByText('Reunión con el guardia'))
    fireEvent.click(within(dialogo()).getByRole('button', { name: '🗑 Eliminar' }))
    await waitFor(() => expect(mocks.removeMedia).toHaveBeenCalledWith('condominios-media', ['p1/minutas/a.jpg', 'p1/minutas-firmas/pa.png']))
  })

  it('la impresión trae la sección de firmas: la imagen de quien firmó y la línea de quien falta', async () => {
    mocks.downloadMedia.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    const { write, print } = ventanaDeImpresion()
    render(<NotasAdminTab {...props({ notas: [{ ...abierta, firmas: [firmaDe(abierta, 'pa')] }] })} />)
    fireEvent.click(screen.getByText('Reunión con el guardia'))
    fireEvent.click(within(dialogo()).getByRole('button', { name: '🖨 Imprimir' }))
    await waitFor(() => expect(print).toHaveBeenCalled())
    expect(mocks.downloadMedia).toHaveBeenCalledWith('condominios-media', 'p1/minutas-firmas/pa.png')
    const html = write.mock.calls.at(-1)![0] as string
    expect(html).toContain('<h2>Firmas</h2>')
    expect(html).toMatch(/<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="">/)
    expect(html).toContain('Firma pendiente')
  })
})

describe('Minutas — guardar avance y retomar', () => {
  it('«Guardar avance» en cada paso: la primera vez crea la fila en curso y el asistente sigue sobre ella; después actualiza; «Guardar minuta» la termina', async () => {
    const onRefresh = vi.fn()
    render(<NotasAdminTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva minuta' }))
    const d = dialogo()
    // Sin título no hay avance que guardar
    fireEvent.click(within(d).getByRole('button', { name: '💾 Guardar avance' }))
    expect(mocks.notify).toHaveBeenLastCalledWith(expect.objectContaining({ variant: 'warning', text: expect.stringMatching(/título/) }))
    expect(mocks.createCondominioRowReturning).not.toHaveBeenCalled()

    fireEvent.change(within(d).getByLabelText('Título de la minuta *'), { target: { value: 'Reunión a medias' } })
    fireEvent.click(within(d).getByRole('button', { name: 'Siguiente →' }))
    fireEvent.click(within(d).getByRole('button', { name: '+ Agregar punto' }))
    fireEvent.change(within(d).getByLabelText('Punto 1'), { target: { value: 'Presupuesto' } })
    // Paso 2, sin acuerdos todavía: se guarda igual, en curso en el paso 2
    fireEvent.click(within(d).getByRole('button', { name: '💾 Guardar avance' }))
    await waitFor(() => expect(mocks.createCondominioRowReturning).toHaveBeenCalledTimes(1))
    const [tabla, payload, select] = mocks.createCondominioRowReturning.mock.calls[0] as [string, Record<string, unknown>, string]
    expect(tabla).toBe('notas_admin')
    expect(select).toBe('id')
    expect(payload).toMatchObject({ company_id: 'co1', project_id: 'p1', autor: 'Admin', titulo: 'Reunión a medias', borrador_paso: 2, fotos: [], documentos: [], firmas: [] })
    expect((payload.puntos as { titulo: string }[]).map(p => p.titulo)).toEqual(['Presupuesto'])
    await waitFor(() => expect(mocks.notify).toHaveBeenLastCalledWith(expect.objectContaining({ variant: 'success', title: 'Avance guardado · paso 2 de 4' })))
    expect(onRefresh).toHaveBeenCalledTimes(1)
    // El asistente sigue abierto, en el mismo paso, y ya no «cancela»: cierra
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(within(d).getByText(/Paso 2 de 4/)).toBeTruthy()
    expect(within(d).getByRole('button', { name: 'Cerrar' })).toBeTruthy()
    expect(within(d).queryByRole('button', { name: 'Cancelar' })).toBeNull()

    // Paso 3: el siguiente avance actualiza la fila creada, sin reescribir archivos que no cambiaron
    fireEvent.click(within(d).getByRole('button', { name: 'Siguiente →' }))
    fireEvent.click(within(d).getByRole('button', { name: 'Agregar acuerdo al punto 1' }))
    fireEvent.change(within(d).getByLabelText('Acuerdo del punto 1'), { target: { value: 'Se aprueba' } })
    fireEvent.click(within(d).getByRole('button', { name: '💾 Guardar avance' }))
    await waitFor(() => expect(mocks.updateCondominioRowAfectando).toHaveBeenCalledTimes(1))
    const [, id, campos] = mocks.updateCondominioRowAfectando.mock.calls[0] as [string, string, Record<string, unknown>]
    expect(id).toBe('nueva-1')
    expect(campos).toMatchObject({ borrador_paso: 3 })
    expect(campos.fotos).toBeUndefined()
    expect(campos.documentos).toBeUndefined()
    expect(campos.firmas).toBeUndefined()
    expect(mocks.createCondominioRowReturning).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog')).toBeTruthy()

    // Terminar: «Guardar minuta» deja de estar en curso y cierra
    fireEvent.click(within(d).getByRole('tab', { name: 'Paso 4 · Firmas' }))
    fireEvent.click(within(d).getByRole('button', { name: '✅ Guardar minuta' }))
    await waitFor(() => expect(mocks.updateCondominioRowAfectando).toHaveBeenCalledTimes(2))
    expect((mocks.updateCondominioRowAfectando.mock.calls[1] as [string, string, Record<string, unknown>])[2]).toMatchObject({ borrador_paso: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalledTimes(3)
    expect(mocks.removeMedia).not.toHaveBeenCalled()
  })

  it('si el avance no se pudo guardar, la ventana sigue abierta y no se cierra nada; al cancelar, lo subido se borra', async () => {
    mocks.createCondominioRowReturning.mockResolvedValueOnce({ data: null, error: { message: 'sin permiso' } })
    render(<NotasAdminTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva minuta' }))
    const d = dialogo()
    fireEvent.change(within(d).getByLabelText('Título de la minuta *'), { target: { value: 'Falla' } })
    fireEvent.click(within(d).getByRole('button', { name: '💾 Guardar avance' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenLastCalledWith(expect.objectContaining({ variant: 'error', text: 'sin permiso' })))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(within(d).getByRole('button', { name: 'Cancelar' })).toBeTruthy()
    // Lo que se suba después de un avance guardado y no se guarde, se borra al cerrar; lo guardado no
    mocks.createCondominioRowReturning.mockResolvedValueOnce({ data: { id: 'nueva-2' }, error: null })
    fireEvent.click(within(d).getByRole('button', { name: '💾 Guardar avance' }))
    await waitFor(() => expect(within(d).getByRole('button', { name: 'Cerrar' })).toBeTruthy())
    fireEvent.click(within(d).getByRole('button', { name: 'Siguiente →' }))
    fireEvent.click(within(d).getByRole('button', { name: '+ Agregar punto' }))
    fireEvent.change(within(d).getByLabelText('Punto 1'), { target: { value: 'Tema' } })
    fireEvent.click(within(d).getByRole('tab', { name: 'Paso 3 · Acuerdos' }))
    fireEvent.click(within(d).getByRole('button', { name: 'Simular subida' }))
    fireEvent.click(within(d).getByRole('button', { name: '💾 Guardar avance' }))
    await waitFor(() => expect(mocks.updateCondominioRowAfectando).toHaveBeenCalledTimes(1))
    expect((mocks.updateCondominioRowAfectando.mock.calls[0] as [string, string, Record<string, unknown>])[2]).toMatchObject({ borrador_paso: 3, fotos: ['p1/minutas/nueva.jpg'] })
    fireEvent.click(within(d).getByRole('button', { name: 'Simular subida de documento' }))
    fireEvent.click(within(d).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.removeMedia).toHaveBeenCalledTimes(1)
    expect(mocks.removeMedia).toHaveBeenCalledWith('condominios-media', ['p1/minutas/1785540000000-ab12cd-acta.pdf'])
  })

  it('la tarjeta y el detalle muestran la minuta en curso; «Continuar» abre el asistente en el paso guardado y «Guardar minuta» la termina', async () => {
    const enCurso = nota({ ...abierta, id: 'n3', titulo: 'Reunión a medias', borrador_paso: 3, fecha_recordatorio: null })
    render(<NotasAdminTab {...props({ notas: [enCurso, abierta] })} />)
    expect(screen.getByText('Reunión a medias').closest('button')!.textContent).toContain('En curso · paso 3 de 4')
    expect(screen.getByText('Reunión con el guardia').closest('button')!.textContent).not.toContain('En curso')
    // Filtro «En curso»
    fireEvent.click(screen.getByRole('radio', { name: /En curso/ }))
    expect(screen.getByText('Reunión a medias')).toBeTruthy()
    expect(screen.queryByText('Reunión con el guardia')).toBeNull()

    fireEvent.click(screen.getByText('Reunión a medias'))
    const det = dialogo()
    expect(within(det).getByText(/En curso · paso 3 de 4/)).toBeTruthy()
    expect(within(det).getByText(/Minuta en curso/).parentElement!.textContent).toMatch(/paso 3 \(acuerdos\).*«Continuar»/)
    // Cerrarla avisa de que la captura quedó a medias
    mocks.confirm.mockResolvedValueOnce({ isConfirmed: false })
    fireEvent.click(within(det).getByRole('button', { name: '✓ Cerrar minuta' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringMatching(/captura a medias \(se quedó en el paso 3 de 4\)/) })))
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()

    fireEvent.click(within(det).getByRole('button', { name: '▶ Continuar' }))
    const w = screen.getByRole('dialog', { name: '▶ Retomar minuta' })
    expect(within(w).getByText(/Paso 3 de 4/)).toBeTruthy()
    expect(within(w).getByText('Rondas nocturnas')).toBeTruthy()
    expect(within(w).getByRole('button', { name: '💾 Guardar avance' })).toBeTruthy()
    fireEvent.click(within(w).getByRole('button', { name: '✅ Guardar minuta' }))
    await waitFor(() => expect(mocks.updateCondominioRowAfectando).toHaveBeenCalledTimes(1))
    const [, id, campos] = mocks.updateCondominioRowAfectando.mock.calls[0] as [string, string, Record<string, unknown>]
    expect(id).toBe('n3')
    expect(campos).toMatchObject({ borrador_paso: null, titulo: 'Reunión a medias' })
    // El asistente se cierra y se vuelve al detalle (como al editar).
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '▶ Retomar minuta' })).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Reunión a medias' })).toBeTruthy()
  })

  it('un valor de paso fuera de rango se lee como minuta terminada; una cerrada no está en curso', () => {
    render(<NotasAdminTab {...props({ notas: [nota({ ...abierta, borrador_paso: 9 }), nota({ ...cerrada, borrador_paso: 2 })] })} />)
    fireEvent.click(screen.getByRole('radio', { name: /Todas/ }))
    expect(screen.getByText('Reunión con el guardia').closest('button')!.textContent).not.toContain('En curso')
    expect(screen.getByText('Reunión con jardinería').closest('button')!.textContent).not.toContain('En curso')
    expect(screen.getByRole('radio', { name: /En curso/ }).textContent).toContain('(0)')
  })
})

describe('Minutas — equipo del proyecto', () => {
  it('sin cuentas asignadas lo dice; si el RPC falla, avisa sin ocultar las demás listas', async () => {
    mocks.fetchEquipoProyecto.mockResolvedValueOnce({ data: [], error: null })
    const { unmount } = render(<NotasAdminTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva minuta' }))
    let d = dialogo()
    expect(await within(d).findByText(/Ninguna cuenta activa de la empresa tiene acceso/)).toBeTruthy()
    expect(within(d).getByRole('radio', { name: /Equipo del proyecto/ }).textContent).toContain('(0)')
    unmount()

    mocks.fetchEquipoProyecto.mockResolvedValueOnce({ data: [], error: 'sin permiso' })
    render(<NotasAdminTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva minuta' }))
    d = dialogo()
    expect((await within(d).findByRole('alert')).textContent).toContain('No se pudo cargar el equipo del proyecto: sin permiso')
    expect(within(d).queryByText(/Ninguna cuenta activa/)).toBeNull()
    fireEvent.click(within(d).getByRole('radio', { name: /Empleado/ }))
    expect(within(d).getByRole('button', { name: 'Agregar a Carlos Guardia' })).toBeTruthy()
  })

  it('sin la cuenta de quien registra, entra como «otro · Administración» y la lista del equipo lo ofrece aparte; se busca por rol', async () => {
    render(<NotasAdminTab {...props({ autorId: null, autorRol: null })} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva minuta' }))
    const d = dialogo()
    expect(within(d).getByText('Administración')).toBeTruthy()
    expect(await within(d).findByRole('button', { name: 'Agregar a Admin' })).toBeTruthy()
    fireEvent.change(within(d).getByRole('searchbox', { name: /Buscar en el equipo del proyecto/ }), { target: { value: 'administrador' } })
    expect(within(d).getByRole('button', { name: 'Agregar a Lucía Admin' })).toBeTruthy()
    expect(within(d).queryByRole('button', { name: 'Agregar a Admin' })).toBeNull()
  })

  it('el detalle y la impresión presentan al participante del equipo con su tipo', async () => {
    const conEquipo = nota({ ...abierta, participantes: [{ id: 'pa', tipo: 'equipo', ref_id: 'uB', nombre: 'Admin', detalle: 'Admin Empresa', gestiona: true }] })
    const { write } = ventanaDeImpresion()
    render(<NotasAdminTab {...props({ notas: [conEquipo] })} />)
    fireEvent.click(screen.getByText('Reunión con el guardia'))
    const det = dialogo()
    expect(within(det).getByText('💼 Equipo del proyecto')).toBeTruthy()
    fireEvent.click(within(det).getByRole('button', { name: '🖨 Imprimir' }))
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    expect(String(write.mock.calls[1][0])).toContain('Admin — Admin Empresa <em>(Equipo del proyecto, gestiona)</em>')
  })
})
