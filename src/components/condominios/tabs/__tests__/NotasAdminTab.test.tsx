// Minutas: la lista resume abiertas, compromisos pendientes y vencidos; la
// nueva minuta va en ventana y en tres pasos —participantes (empleado,
// propietario/inquilino, proveedor u otro, con quien gestiona), puntos y
// acuerdos/compromisos por punto—; el detalle marca compromisos cumplidos,
// cierra la minuta y abre la edición con lo guardado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { ContratoArrendamiento, ContratoProveedor, NotaAdmin, PersonalCondominio, Unidad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  updateCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  deleteCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  fetchResidentesProyecto: vi.fn(async (_projectId: string) => [
    { id: 'r1', unidad_id: 'u2', cliente_id: 'c1', tipo: 'propietario', nombre: 'María Pérez', unidad_nombre: 'Casa 2' },
  ]),
  useProveedoresQuery: vi.fn(() => ({ data: [{ id: 'v1', company_id: 'co1', nombre: 'Limpiezas SA', activo: true, contacto_nombre: 'Rosa' }], isLoading: false })),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify, confirm: mocks.confirm }))
vi.mock('../../../../domain/cxp/queries', () => ({ useProveedoresQuery: mocks.useProveedoresQuery }))
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
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 26, 12, 0, 0)) // 26 oct 2026
  mocks.createCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
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
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenLastCalledWith('notas_admin', 'n1', expect.objectContaining({ titulo: 'Reunión con el guardia', fecha_reunion: '2026-10-22' })))
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
