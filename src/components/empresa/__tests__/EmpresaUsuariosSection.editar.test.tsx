// EmpresaUsuariosSection · «Editar» (nombre, correo y contraseña, vía el edge update-user):
//  · el propietario ve el botón habilitado sobre las personas editables; un administrador lo ve deshabilitado con el motivo, y forzar el manejador tampoco llama al servidor;
//  · el formulario se precarga con los datos actuales (el correo no está en la lista: lo devuelve el edge) y sólo se envía lo que cambió;
//  · sin cambios no se escribe; un rechazo del servidor se muestra tal cual.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ notify: vi.fn(), prompt: vi.fn(), updateCompanyUser: vi.fn() }))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}), auth: {} } }))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify }))
vi.mock('../../shared/PromptDialog', () => ({ openPromptDialog: h.prompt }))
vi.mock('../AsignacionModal', () => ({ AsignacionModal: () => null }))
vi.mock('../RolPermisosModal', () => ({ RolPermisosModal: () => null }))
vi.mock('../CustomRoleEditor', () => ({ CustomRoleEditor: () => null }))
vi.mock('../AuditLogModal', () => ({ AuditLogModal: () => null }))
vi.mock('../FinancialAuditModal', () => ({ FinancialAuditModal: () => null }))
vi.mock('../PapeleraModal', () => ({ PapeleraModal: () => null }))
vi.mock('../SavedReportsModal', () => ({ SavedReportsModal: () => null }))
vi.mock('../../../domain/empresa/usuarios', async () => {
  const real = await vi.importActual<typeof import('../../../domain/empresa/usuarios')>('../../../domain/empresa/usuarios')
  return { ...real, updateCompanyUser: h.updateCompanyUser }
})
vi.mock('../../../domain/empresa/roles', () => ({ insertUserRoles: vi.fn(), ensureCompanyRoleFromTemplate: vi.fn() }))

import { EmpresaUsuariosSection } from '../EmpresaUsuariosSection'

const USUARIOS = [
  { id: 'u-op', full_name: 'Operadora', role: 'operator', activo: true },
  { id: 'u-own2', full_name: 'Otro Propietario', role: 'company_owner', activo: true },
]
const onReload = vi.fn()

function montar(rol: string) {
  cleanup()
  render(
    <EmpresaUsuariosSection
      currentUser={{ user_id: 'u-yo', email: '', name: 'Yo', role: rol, company_id: 'c1', login_time: '', expires_at: '' } as never}
      usuarios={USUARIOS as never}
      proyectos={[]}
      onReload={onReload}
    />,
  )
}
const botones = () => screen.getAllByRole('button', { name: /^Editar$/ }) as HTMLButtonElement[]
function forzarClick(el: HTMLElement) {
  const clave = Object.keys(el).find(k => k.startsWith('__reactProps$'))!
  ;(el as unknown as Record<string, { onClick?: () => void }>)[clave].onClick?.()
}
const ACTUAL = { data: { full_name: 'Operadora', email: 'ope@x.test', changed: [] }, error: null }

beforeEach(() => {
  cleanup()
  for (const m of [h.notify, h.prompt, h.updateCompanyUser, onReload]) m.mockReset()
  h.updateCompanyUser.mockResolvedValue(ACTUAL)
})

describe('«Editar» · quién lo ve habilitado', () => {
  it('propietario: habilitado sobre un operador, deshabilitado sobre otro propietario', () => {
    montar('company_owner')
    const [op, own] = botones()
    expect(op.disabled).toBe(false)
    expect(own.disabled).toBe(true)
  })

  it('administrador: deshabilitado con el motivo, y forzar el manejador NO llama al servidor', async () => {
    montar('admin')
    const [op] = botones()
    expect(op.disabled).toBe(true)
    expect(op.title).toMatch(/propietario/i)
    forzarClick(op)
    await Promise.resolve()
    expect(h.updateCompanyUser).not.toHaveBeenCalled()
    expect(h.prompt).not.toHaveBeenCalled()
  })
})

describe('«Editar» · flujo del propietario', () => {
  it('precarga nombre y correo actuales y envía SÓLO lo que cambió (correo normalizado)', async () => {
    h.prompt.mockResolvedValue({ nombre: 'Operadora', email: ' Nueva@X.Test ', password: '' })
    montar('company_owner')
    fireEvent.click(botones()[0])
    await waitFor(() => expect(h.updateCompanyUser).toHaveBeenCalledTimes(2))
    expect(h.updateCompanyUser.mock.calls[0]).toEqual(['u-op'])
    const campos = h.prompt.mock.calls[0][0].fields as Array<{ name: string; initialValue?: string }>
    expect(campos.find(c => c.name === 'nombre')!.initialValue).toBe('Operadora')
    expect(campos.find(c => c.name === 'email')!.initialValue).toBe('ope@x.test')
    expect(campos.find(c => c.name === 'password')!.initialValue).toBeUndefined()
    expect(h.updateCompanyUser.mock.calls[1]).toEqual(['u-op', { email: 'nueva@x.test' }])
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1))
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Usuario actualizado' }))
  })

  it('nombre y contraseña: los envía y recuerda compartir la contraseña', async () => {
    h.prompt.mockResolvedValue({ nombre: ' Operadora Uno ', email: 'ope@x.test', password: 'Abcdef12' })
    montar('company_owner')
    fireEvent.click(botones()[0])
    await waitFor(() => expect(h.updateCompanyUser).toHaveBeenCalledTimes(2))
    expect(h.updateCompanyUser.mock.calls[1]).toEqual(['u-op', { full_name: 'Operadora Uno', password: 'Abcdef12' }])
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', text: expect.stringMatching(/contraseña/i) })))
  })

  it('sin cambios: no escribe ni recarga', async () => {
    h.prompt.mockResolvedValue({ nombre: 'Operadora', email: 'ope@x.test', password: '' })
    montar('company_owner')
    fireEvent.click(botones()[0])
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Sin cambios' })))
    expect(h.updateCompanyUser).toHaveBeenCalledTimes(1)
    expect(onReload).not.toHaveBeenCalled()
  })

  it('cancelar el formulario no escribe, y el botón vuelve a quedar disponible', async () => {
    h.prompt.mockResolvedValue(null)
    montar('company_owner')
    fireEvent.click(botones()[0])
    await waitFor(() => expect(h.prompt).toHaveBeenCalled())
    await waitFor(() => expect(botones()[0].disabled).toBe(false))
    expect(h.updateCompanyUser).toHaveBeenCalledTimes(1)
  })

  it('la validación del formulario rechaza nombre vacío, correo inválido y contraseña corta', async () => {
    h.prompt.mockResolvedValue(null)
    montar('company_owner')
    fireEvent.click(botones()[0])
    await waitFor(() => expect(h.prompt).toHaveBeenCalled())
    const validate = h.prompt.mock.calls[0][0].validate as (d: Record<string, string>) => string | null
    expect(validate({ nombre: ' ', email: 'a@b.co', password: '' })).toMatch(/nombre/i)
    expect(validate({ nombre: 'A', email: 'nada', password: '' })).toMatch(/correo/i)
    expect(validate({ nombre: 'A', email: 'a@b.co', password: '123' })).toMatch(/8 caracteres/)
    expect(validate({ nombre: 'A', email: 'a@b.co', password: '' })).toBeNull()
    expect(validate({ nombre: 'A', email: 'a@b.co', password: '12345678' })).toBeNull()
  })

  it('si no se pueden cargar los datos actuales, se avisa y no se abre el formulario', async () => {
    h.updateCompanyUser.mockResolvedValue({ data: null, error: 'Usuario no encontrado' })
    montar('company_owner')
    fireEvent.click(botones()[0])
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Usuario no encontrado' })))
    expect(h.prompt).not.toHaveBeenCalled()
  })

  it('un rechazo del servidor al guardar se muestra tal cual', async () => {
    h.prompt.mockResolvedValue({ nombre: 'Operadora', email: 'tomado@x.test', password: '' })
    h.updateCompanyUser.mockResolvedValueOnce(ACTUAL).mockResolvedValueOnce({ data: null, error: 'Ese correo ya está en uso por otra cuenta.' })
    montar('company_owner')
    fireEvent.click(botones()[0])
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Ese correo ya está en uso por otra cuenta.' })))
    expect(h.notify).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }))
  })
})
