import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { PersonalCondominio, UsuarioAsignablePersonal } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null as { message: string } | null })),
  updateCondominioRow: vi.fn(async () => ({ error: null as { message: string } | null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null as { message: string } | null })),
  fetchUsuariosAsignablesPersonal: vi.fn(async () => ({
    data: [] as UsuarioAsignablePersonal[],
    error: null as { message: string } | null,
  })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: () => ({}), rpc: () => ({}), storage: { from: () => ({}) } },
  db: { from: () => ({}), rpc: () => ({}) },
}))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({
  fetchUsuariosAsignablesPersonal: mocks.fetchUsuariosAsignablesPersonal,
}))
vi.mock('../../../shared/Dialog', () => ({
  confirm: mocks.confirm,
  notify: mocks.notify,
}))

const { PersonalTab } = await import('../PersonalTab')

function empleado(over: Partial<PersonalCondominio> = {}): PersonalCondominio {
  return {
    id: 'emp1', company_id: 'c1', project_id: 'p1', nombre: 'Dina Villatoro',
    cargo: 'conserje', turno: 'diurno', estado: 'activo',
    created_at: '2026-01-02T00:00:00.000Z',
    ...over,
  } as PersonalCondominio
}

function cuenta(over: Partial<UsuarioAsignablePersonal> = {}): UsuarioAsignablePersonal {
  return {
    usuario_id: 'u1', nombre: 'Dina Villatoro', email: 'dina@mayan.com',
    rol: 'operator', activo: true, tiene_acceso_proyecto: true,
    personal_id: null, personal_nombre: null,
    ...over,
  }
}

function renderTab(props: Partial<Parameters<typeof PersonalTab>[0]> = {}) {
  return render(
    <PersonalTab
      personal={[empleado()]}
      proyectoId="p1"
      companyId="c1"
      moneda="Q"
      canCreate
      canEdit
      onRefresh={() => {}}
      {...props}
    />,
  )
}

/** Abre el formulario de alta y espera a que el selector de cuenta exista. */
async function abrirAlta() {
  fireEvent.click(screen.getByText('+ Agregar Personal'))
  return screen.findByLabelText('Cuenta con la que ingresa')
}

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockClear())
  mocks.confirm.mockResolvedValue({ isConfirmed: true })
  mocks.createCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.deleteCondominioRow.mockResolvedValue({ error: null })
  mocks.fetchUsuariosAsignablesPersonal.mockResolvedValue({ data: [cuenta()], error: null })
})

afterEach(() => { cleanup() })

describe('PersonalTab — usuario de ingreso del empleado', () => {
  it('pide el catálogo de cuentas del proyecto al montar', async () => {
    renderTab()
    await waitFor(() => expect(mocks.fetchUsuariosAsignablesPersonal).toHaveBeenCalledTimes(1))
    expect(mocks.fetchUsuariosAsignablesPersonal.mock.calls[0]).toEqual(['p1'])
  })

  it('el selector muestra nombre y correo, y bloquea la cuenta que ya es de otro empleado', async () => {
    mocks.fetchUsuariosAsignablesPersonal.mockResolvedValue({
      data: [
        cuenta(),
        cuenta({ usuario_id: 'u2', nombre: 'Marco Guardia', email: 'marco@mayan.com', personal_id: 'emp9', personal_nombre: 'Marco Pérez' }),
      ],
      error: null,
    })
    renderTab()
    await abrirAlta()

    // El correo es lo único que distingue dos homónimos: es el login real.
    expect(screen.getByRole('option', { name: 'Dina Villatoro · dina@mayan.com' })).toBeTruthy()

    // La cuenta tomada se muestra (para explicar por qué no se puede) pero no se
    // puede elegir: el índice único de la BD la rechazaría igual.
    const tomada = screen.getByRole('option', { name: /Marco Guardia .* ya es Marco Pérez/ }) as HTMLOptionElement
    expect(tomada.disabled).toBe(true)
  })

  it('la cuenta que YA tiene el empleado en edición sigue siendo elegible', async () => {
    mocks.fetchUsuariosAsignablesPersonal.mockResolvedValue({
      data: [cuenta({ personal_id: 'emp1', personal_nombre: 'Dina Villatoro' })],
      error: null,
    })
    renderTab({ personal: [empleado({ user_id: 'u1' })] })

    fireEvent.click(screen.getByText('✏️'))
    const select = await screen.findByLabelText('Cuenta con la que ingresa') as HTMLSelectElement
    expect(select.value).toBe('u1')
    const propia = screen.getByRole('option', { name: /Dina Villatoro/ }) as HTMLOptionElement
    expect(propia.disabled).toBe(false)
  })

  it('guardar envía el user_id elegido', async () => {
    renderTab({ personal: [] })
    const select = await abrirAlta()

    fireEvent.change(screen.getByPlaceholderText('Nombre completo'), { target: { value: 'Dina Villatoro' } })
    fireEvent.change(select, { target: { value: 'u1' } })
    fireEvent.click(screen.getByText('Agregar'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('personal_condominio')
    expect(payload.user_id).toBe('u1')
  })

  it('desvincular manda user_id null, no lo omite', async () => {
    // Omitirlo dejaría el vínculo viejo intacto: el update es parcial.
    renderTab({ personal: [empleado({ user_id: 'u1' })] })
    fireEvent.click(screen.getByText('✏️'))
    const select = await screen.findByLabelText('Cuenta con la que ingresa')

    fireEvent.change(select, { target: { value: '' } })
    fireEvent.click(screen.getByText('Actualizar'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [, id, payload] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(id).toBe('emp1')
    expect(payload.user_id).toBeNull()
  })

  it('el selector no ofrece cuentas de la empresa sin acceso a este condominio', async () => {
    // El caso del administrador de un condominio en una empresa con varios: la
    // garita del proyecto de al lado no puede registrar nada aquí, y ofrecerla
    // solo invita a sellar el expediente con la cuenta de otro condominio.
    mocks.fetchUsuariosAsignablesPersonal.mockResolvedValue({
      data: [
        cuenta(),
        cuenta({ usuario_id: 'u2', nombre: 'Garita Otro Proyecto', email: 'garita@mayan.com', tiene_acceso_proyecto: false }),
      ],
      error: null,
    })
    renderTab({ personal: [] })
    await abrirAlta()

    expect(screen.getByRole('option', { name: 'Dina Villatoro · dina@mayan.com' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: /Garita Otro Proyecto/ })).toBeNull()
    // Se dice cuántas se ocultaron y cómo hacerlas aparecer: en silencio, el
    // administrador buscaría una cuenta que existe y creería que falta crearla.
    expect(screen.getByText(/otra cuenta de la empresa no aparece/)).toBeTruthy()
  })

  it('la cuenta ya vinculada aquí sigue en la lista aunque haya perdido el acceso, y se avisa', async () => {
    mocks.fetchUsuariosAsignablesPersonal.mockResolvedValue({
      data: [cuenta({ tiene_acceso_proyecto: false, personal_id: 'emp1', personal_nombre: 'Dina Villatoro' })],
      error: null,
    })
    renderTab({ personal: [empleado({ user_id: 'u1' })] })

    fireEvent.click(screen.getByText('✏️'))
    const select = await screen.findByLabelText('Cuenta con la que ingresa') as HTMLSelectElement
    expect(select.value).toBe('u1')
    expect(screen.getByRole('option', { name: /Dina Villatoro/ })).toBeTruthy()
    expect(await screen.findByText(/aún no tiene acceso a este condominio/)).toBeTruthy()
  })

  it('avisa cuando la cuenta elegida está desactivada', async () => {
    mocks.fetchUsuariosAsignablesPersonal.mockResolvedValue({
      data: [cuenta({ activo: false })],
      error: null,
    })
    renderTab({ personal: [] })
    const select = await abrirAlta()

    fireEvent.change(select, { target: { value: 'u1' } })
    expect(await screen.findByText(/está desactivada/)).toBeTruthy()
  })

  it('la tarjeta distingue de un vistazo al vinculado del que no lo está', async () => {
    renderTab({
      personal: [
        empleado({ user_id: 'u1' }),
        empleado({ id: 'emp2', nombre: 'Marco Guardia', cargo: 'guardia', user_id: null }),
      ],
    })
    // El nombre de la cuenta sale del catálogo, no de la fila del empleado.
    expect(await screen.findByText('🔐 Dina Villatoro')).toBeTruthy()
    expect(screen.getByText('🔓 Sin usuario de ingreso')).toBeTruthy()
    expect(screen.getByText(/1 activo sin usuario de ingreso/)).toBeTruthy()
  })

  it('un empleado vinculado a una cuenta que el catálogo no trae no se muestra como suelto', async () => {
    // Pasa si la carga del catálogo falla: el vínculo existe igual y borrarlo de
    // la vista invitaría a asignar la misma cuenta dos veces.
    mocks.fetchUsuariosAsignablesPersonal.mockResolvedValue({ data: [], error: { message: 'No autorizado' } })
    renderTab({ personal: [empleado({ user_id: 'u1' })] })
    expect(await screen.findByText('🔐 Cuenta vinculada')).toBeTruthy()
  })

  it('editar sin catálogo conserva el vínculo en vez de borrarlo al guardar', async () => {
    mocks.fetchUsuariosAsignablesPersonal.mockResolvedValue({ data: [], error: { message: 'No autorizado' } })
    renderTab({ personal: [empleado({ user_id: 'u1' })] })

    fireEvent.click(screen.getByText('✏️'))
    const select = await screen.findByLabelText('Cuenta con la que ingresa') as HTMLSelectElement
    expect(select.value).toBe('u1')

    fireEvent.click(screen.getByText('Actualizar'))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [, , payload] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(payload.user_id).toBe('u1')
  })

  it('un fallo del catálogo se distingue de "no hay usuarios que asignar"', async () => {
    mocks.fetchUsuariosAsignablesPersonal.mockResolvedValue({ data: [], error: { message: 'No autorizado' } })
    renderTab({ personal: [] })
    await abrirAlta()

    expect(screen.getByText(/No se pudo cargar la lista de usuarios/)).toBeTruthy()
    expect(screen.queryByText(/tiene acceso a este condominio todavía/)).toBeNull()
  })

  it('sin cuentas con acceso al condominio explica cómo conseguirlas', async () => {
    mocks.fetchUsuariosAsignablesPersonal.mockResolvedValue({ data: [], error: null })
    renderTab({ personal: [] })
    await abrirAlta()

    expect(screen.getByText(/tiene acceso a este condominio todavía/)).toBeTruthy()
  })

  it('el choque del índice único se traduce a un mensaje accionable', async () => {
    mocks.updateCondominioRow.mockResolvedValue({
      error: { message: 'duplicate key value violates unique constraint "personal_condominio_user_unico_por_proyecto"' },
    })
    renderTab({ personal: [empleado({ user_id: null })] })
    fireEvent.click(screen.getByText('✏️'))
    const select = await screen.findByLabelText('Cuenta con la que ingresa')

    fireEvent.change(select, { target: { value: 'u1' } })
    fireEvent.click(screen.getByText('Actualizar'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    const arg = mocks.notify.mock.calls[0][0] as { text: string }
    expect(arg.text).toMatch(/ya está vinculada a otro empleado/)
  })

  it('tras guardar se recarga el catálogo (la cuenta quedó tomada)', async () => {
    renderTab({ personal: [empleado()] })
    await waitFor(() => expect(mocks.fetchUsuariosAsignablesPersonal).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('✏️'))
    await screen.findByLabelText('Cuenta con la que ingresa')
    fireEvent.change(screen.getByLabelText('Cuenta con la que ingresa'), { target: { value: 'u1' } })
    fireEvent.click(screen.getByText('Actualizar'))

    await waitFor(() => expect(mocks.fetchUsuariosAsignablesPersonal).toHaveBeenCalledTimes(2))
  })
})
