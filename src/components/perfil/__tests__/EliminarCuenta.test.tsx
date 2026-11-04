// «Eliminar mi cuenta»: el flujo en dos pasos con el servidor delante (previsualización → aviso → contraseña + palabra → borrado → salida).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(async (_o: { text: string }) => ({ isConfirmed: true })),
  openPromptDialog: vi.fn(async (_o: unknown) => ({ password: 'secreta', confirmacion: 'ELIMINAR' }) as Record<string, string> | null),
  previewDeleteOwnAccount: vi.fn(async (): Promise<{ data: { suspendeEmpresa: boolean } | null; error: string | null }> => ({ data: { suspendeEmpresa: false }, error: null })),
  deleteOwnAccount: vi.fn(async (_c: string) => ({ error: null as string | null })),
  signInWithPassword: vi.fn(async (_e: string, _p: string) => ({ error: null as string | null })),
  fetchCurrentAuthProvider: vi.fn(async () => 'email' as string | undefined),
  signOutAfterOwnAccountDeleted: vi.fn(async () => {}),
}))

vi.mock('../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: vi.fn() }))
vi.mock('../../shared/PromptDialog', () => ({ openPromptDialog: mocks.openPromptDialog }))
vi.mock('../../../domain/auth/account', () => ({
  DELETE_OWN_ACCOUNT_CONFIRM_WORD: 'ELIMINAR',
  previewDeleteOwnAccount: mocks.previewDeleteOwnAccount,
  deleteOwnAccount: mocks.deleteOwnAccount,
  signInWithPassword: mocks.signInWithPassword,
  fetchCurrentAuthProvider: mocks.fetchCurrentAuthProvider,
  signOutAfterOwnAccountDeleted: mocks.signOutAfterOwnAccountDeleted,
}))

const { EliminarCuenta, textoConsecuencias } = await import('../EliminarCuenta')

type PromptOpts = { fields: Array<{ name: string; type?: string }>; validate: (d: Record<string, string>) => Promise<string | null> }
const ultimoPrompt = () => mocks.openPromptDialog.mock.calls.at(-1)![0] as PromptOpts
const ultimoConfirm = () => mocks.confirm.mock.calls.at(-1)![0]

const yo = { email: 'yo@ejemplo.com', role: 'operator' as const }

async function esperarProveedor() {
  await waitFor(() => expect(mocks.fetchCurrentAuthProvider).toHaveBeenCalled())
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockClear())
  mocks.confirm.mockResolvedValue({ isConfirmed: true })
  mocks.openPromptDialog.mockResolvedValue({ password: 'secreta', confirmacion: 'ELIMINAR' })
  mocks.previewDeleteOwnAccount.mockResolvedValue({ data: { suspendeEmpresa: false }, error: null })
  mocks.deleteOwnAccount.mockResolvedValue({ error: null })
  mocks.signInWithPassword.mockResolvedValue({ error: null })
  mocks.fetchCurrentAuthProvider.mockResolvedValue('email')
})
afterEach(cleanup)

describe('EliminarCuenta · camino feliz', () => {
  it('previsualiza, avisa, pide contraseña + ELIMINAR, borra con la palabra exacta y sale tras el aviso', async () => {
    const onDeleted = vi.fn()
    render(<EliminarCuenta currentUser={yo} onDeleted={onDeleted} demoraSalidaMs={0} />)
    await esperarProveedor()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }))

    await waitFor(() => expect(mocks.deleteOwnAccount).toHaveBeenCalledWith('ELIMINAR'))
    // el orden: previsualización ANTES del aviso, aviso ANTES del formulario
    expect(mocks.previewDeleteOwnAccount.mock.invocationCallOrder[0]).toBeLessThan(mocks.confirm.mock.invocationCallOrder[0])
    expect(mocks.confirm.mock.invocationCallOrder[0]).toBeLessThan(mocks.openPromptDialog.mock.invocationCallOrder[0])
    expect(ultimoConfirm().text).toBe(textoConsecuencias('operator', false))
    expect(ultimoPrompt().fields.map((f) => f.name)).toEqual(['password', 'confirmacion'])
    expect(ultimoPrompt().fields[0]!.type).toBe('password')

    expect((await screen.findByRole('status')).textContent).toContain('Tu cuenta se eliminó')
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
    expect(mocks.signOutAfterOwnAccountDeleted).not.toHaveBeenCalled()
  })

  it('la validación del formulario exige la palabra exacta y verifica la contraseña actual antes de borrar', async () => {
    render(<EliminarCuenta currentUser={yo} onDeleted={vi.fn()} demoraSalidaMs={0} />)
    await esperarProveedor()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }))
    await waitFor(() => expect(mocks.openPromptDialog).toHaveBeenCalled())
    const { validate } = ultimoPrompt()

    expect(await validate({ password: 'secreta', confirmacion: 'eliminar' })).toMatch(/ELIMINAR/)
    expect(await validate({ password: 'secreta', confirmacion: '' })).toMatch(/ELIMINAR/)
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()

    mocks.signInWithPassword.mockResolvedValueOnce({ error: 'Invalid login credentials' })
    expect(await validate({ password: 'mala', confirmacion: 'ELIMINAR' })).toBe('La contraseña es incorrecta.')
    expect(mocks.signInWithPassword).toHaveBeenCalledWith('yo@ejemplo.com', 'mala')

    expect(await validate({ password: 'secreta', confirmacion: ' ELIMINAR ' })).toBeNull()
  })

  it('una cuenta de Google no tiene contraseña: sólo se pide la palabra y no se llama a signInWithPassword', async () => {
    mocks.fetchCurrentAuthProvider.mockResolvedValue('google')
    render(<EliminarCuenta currentUser={yo} onDeleted={vi.fn()} demoraSalidaMs={0} />)
    await esperarProveedor()
    await waitFor(() => expect(mocks.fetchCurrentAuthProvider).toHaveResolved())
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }))
    await waitFor(() => expect(mocks.openPromptDialog).toHaveBeenCalled())
    expect(ultimoPrompt().fields.map((f) => f.name)).toEqual(['confirmacion'])
    expect(await ultimoPrompt().validate({ confirmacion: 'ELIMINAR' })).toBeNull()
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
  })

  it('el único propietario lee que su empresa quedará suspendida; el residente, que el expediente de la empresa no se borra', async () => {
    mocks.previewDeleteOwnAccount.mockResolvedValue({ data: { suspendeEmpresa: true }, error: null })
    render(<EliminarCuenta currentUser={{ email: 'd@x.com', role: 'company_owner' }} onDeleted={vi.fn()} demoraSalidaMs={0} />)
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    expect(ultimoConfirm().text).toMatch(/único propietario.*quedará suspendida/)
    expect(textoConsecuencias('cliente', false)).toMatch(/no se borran con tu cuenta/)
    expect(textoConsecuencias('admin', false)).toMatch(/se conservan sin tu nombre/)
  })
})

describe('EliminarCuenta · frenos', () => {
  it('si la previsualización devuelve el 409 del servidor, se muestra tal cual y no se pide nada más', async () => {
    mocks.previewDeleteOwnAccount.mockResolvedValue({ data: null, error: 'Eres el único propietario de la empresa y otra persona tiene acceso a ella.' })
    render(<EliminarCuenta currentUser={{ email: 'd@x.com', role: 'company_owner' }} onDeleted={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }))
    expect((await screen.findByRole('alert')).textContent).toContain('único propietario')
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.openPromptDialog).not.toHaveBeenCalled()
    expect(mocks.deleteOwnAccount).not.toHaveBeenCalled()
  })

  it('cancelar en el aviso o en el formulario no borra nada y deja el botón disponible', async () => {
    const onDeleted = vi.fn()
    mocks.confirm.mockResolvedValueOnce({ isConfirmed: false })
    render(<EliminarCuenta currentUser={yo} onDeleted={onDeleted} />)
    await esperarProveedor()
    const boton = screen.getByRole('button', { name: 'Eliminar mi cuenta' })
    fireEvent.click(boton)
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))
    expect(mocks.openPromptDialog).not.toHaveBeenCalled()

    mocks.openPromptDialog.mockResolvedValueOnce(null)
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar mi cuenta' }))
    await waitFor(() => expect(mocks.openPromptDialog).toHaveBeenCalledTimes(1))
    expect(mocks.deleteOwnAccount).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
    expect((await screen.findByRole('button', { name: 'Eliminar mi cuenta' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('si el servidor rechaza el borrado, se muestra su mensaje y no se sale', async () => {
    const onDeleted = vi.fn()
    mocks.deleteOwnAccount.mockResolvedValue({ error: 'Tu empresa tiene una suscripción de pago activa…' })
    render(<EliminarCuenta currentUser={yo} onDeleted={onDeleted} demoraSalidaMs={0} />)
    await esperarProveedor()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }))
    expect((await screen.findByRole('alert')).textContent).toContain('suscripción de pago activa')
    expect(onDeleted).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('EliminarCuenta · variantes', () => {
  it('«enlace» es un botón discreto con el mismo flujo; «seccion» trae su propio título; «contenido» enlaza a la página pública', async () => {
    const { unmount } = render(<EliminarCuenta currentUser={yo} variant="enlace" onDeleted={vi.fn()} demoraSalidaMs={0} />)
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }))
    await waitFor(() => expect(mocks.deleteOwnAccount).toHaveBeenCalledWith('ELIMINAR'))
    unmount()

    render(<EliminarCuenta currentUser={yo} variant="seccion" onDeleted={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Eliminar mi cuenta' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /eliminar-cuenta/ }).getAttribute('href')).toBe('/eliminar-cuenta')
  })
})
