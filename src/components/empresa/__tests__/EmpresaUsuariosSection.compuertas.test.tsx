// EmpresaUsuariosSection: flujos del PROPIETARIO (que no se rompen) y compuertas de quien NO es el principal (defensa en profundidad: la ruta /empresa sólo la abre el propietario).
//  · «Nuevo Usuario» del propietario: orden create-user → rol de plantilla → user_roles, con promesas controladas; el tier de plataforma de un «Admin de Agua» es operator;
//  · el error de insertUserRoles ya NO se ignora: si el servidor rechaza la asignación de roles la pantalla no dice «Usuario creado» como éxito (E-05);
//  · «Nuevo Usuario» y «Activar/Desactivar» se deshabilitan con la explicación para quien no es el principal, y forzar el manejador del botón tampoco escribe;
//  · «Eliminar» sigue el gate de delete-user: un administrador no elimina a otro administrador (E-07).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'

const h = vi.hoisted(() => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }
  return {
    deferred,
    notify: vi.fn(),
    prompt: vi.fn(),
    createCompanyUser: vi.fn(),
    deleteCompanyUser: vi.fn(),
    setUsuarioActivo: vi.fn(),
    insertUserRoles: vi.fn(),
    ensureCompanyRoleFromTemplate: vi.fn(),
    orden: [] as string[],
  }
})

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
  return { ...real, createCompanyUser: h.createCompanyUser, deleteCompanyUser: h.deleteCompanyUser, setUsuarioActivo: h.setUsuarioActivo }
})
vi.mock('../../../domain/empresa/roles', () => ({
  insertUserRoles: h.insertUserRoles,
  ensureCompanyRoleFromTemplate: h.ensureCompanyRoleFromTemplate,
}))

import { EmpresaUsuariosSection } from '../EmpresaUsuariosSection'
import { SYSTEM_ROLE_IDS } from '../../../lib/systemRoleIds'

const USUARIOS = [
  { id: 'u-yo', full_name: 'Yo Mismo', role: 'admin', activo: true },
  { id: 'u-adm2', full_name: 'Otro Admin', role: 'admin', activo: true },
  { id: 'u-op', full_name: 'Operadora', role: 'operator', activo: true },
]

function montar(rol: string, onReload: () => void = () => {}) {
  cleanup()
  render(
    <EmpresaUsuariosSection
      currentUser={{ user_id: 'u-yo', email: '', name: 'Yo Mismo', role: rol, company_id: 'c1', login_time: '', expires_at: '' } as never}
      usuarios={USUARIOS as never}
      proyectos={[]}
      onReload={onReload}
    />,
  )
}
// fireEvent.click sobre un botón deshabilitado NO dispara onClick (como el navegador): para forzar la llamada se invoca el manejador de React.
function forzarClick(el: HTMLElement) {
  const clave = Object.keys(el).find(k => k.startsWith('__reactProps$'))!
  ;(el as unknown as Record<string, { onClick?: () => void }>)[clave].onClick?.()
}

const FORM = { nombre: 'Nueva Persona', email: 'nueva@ejemplo.com', password: 'Abcdef12', aguaEnabled: 'true', aguaRol: 'admin' }

beforeEach(() => {
  cleanup()
  for (const m of [h.notify, h.prompt, h.createCompanyUser, h.deleteCompanyUser, h.setUsuarioActivo, h.insertUserRoles, h.ensureCompanyRoleFromTemplate]) m.mockReset()
  h.orden = []
  h.prompt.mockResolvedValue(FORM)
})

describe('«Nuevo Usuario» del PROPIETARIO (su flujo no se rompe)', () => {
  it('con promesas controladas: create-user primero; sólo después el rol de plantilla y user_roles; el tier de plataforma de un «Admin de Agua» es operator', async () => {
    const crear = h.deferred<{ userId: string | null; error: string | null }>()
    const plantilla = h.deferred<{ data: { id: string } | null; error: string | null }>()
    const asignar = h.deferred<{ error: string | null }>()
    h.createCompanyUser.mockImplementation(() => { h.orden.push('create-user'); return crear.promise })
    h.ensureCompanyRoleFromTemplate.mockImplementation(() => { h.orden.push('plantilla'); return plantilla.promise })
    h.insertUserRoles.mockImplementation(() => { h.orden.push('user_roles'); return asignar.promise })
    const onReload = vi.fn()
    montar('company_owner', onReload)

    fireEvent.click(screen.getByRole('button', { name: /Nuevo Usuario/ }))
    await waitFor(() => expect(h.createCompanyUser).toHaveBeenCalledTimes(1))
    // el tier de plataforma NUNCA es admin para el «Admin de Agua» (admin saltaría todo el RBAC): operator
    expect(h.createCompanyUser).toHaveBeenCalledWith(expect.objectContaining({ role: 'operator', company_id: 'c1', email: 'nueva@ejemplo.com' }))
    // mientras create-user no responde NO se toca el RBAC
    expect(h.orden).toEqual(['create-user'])
    expect(h.ensureCompanyRoleFromTemplate).not.toHaveBeenCalled()

    crear.resolve({ userId: 'nuevo-1', error: null })
    await waitFor(() => expect(h.ensureCompanyRoleFromTemplate).toHaveBeenCalledTimes(1))
    expect(h.ensureCompanyRoleFromTemplate).toHaveBeenCalledWith('c1', SYSTEM_ROLE_IDS.agua.admin)
    expect(h.insertUserRoles).not.toHaveBeenCalled()

    plantilla.resolve({ data: { id: 'rol-empresa-admin-agua' }, error: null })
    await waitFor(() => expect(h.insertUserRoles).toHaveBeenCalledTimes(1))
    expect(h.insertUserRoles).toHaveBeenCalledWith([{ user_id: 'nuevo-1', role_id: 'rol-empresa-admin-agua' }])
    // hasta que user_roles responde no se dice «creado» ni se recarga
    expect(h.notify).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Usuario creado' }))
    expect(onReload).not.toHaveBeenCalled()

    asignar.resolve({ error: null })
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Usuario creado' })))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('si create-user falla no se toca el RBAC ni se recarga', async () => {
    h.createCompanyUser.mockResolvedValue({ userId: null, error: 'Solo el propietario de la empresa puede crear administradores.' })
    const onReload = vi.fn()
    montar('company_owner', onReload)
    fireEvent.click(screen.getByRole('button', { name: /Nuevo Usuario/ }))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', title: 'Error al crear usuario' })))
    expect(h.ensureCompanyRoleFromTemplate).not.toHaveBeenCalled()
    expect(h.insertUserRoles).not.toHaveBeenCalled()
    expect(onReload).not.toHaveBeenCalled()
  })

  it('E-05 · si el servidor rechaza la asignación de roles (insertUserRoles devuelve error) la pantalla NO dice «Usuario creado» como éxito: avisa que quedó sin permisos y recarga la lista', async () => {
    h.createCompanyUser.mockResolvedValue({ userId: 'nuevo-2', error: null })
    h.ensureCompanyRoleFromTemplate.mockResolvedValue({ data: { id: 'rol-empresa' }, error: null })
    h.insertUserRoles.mockResolvedValue({ error: 'new row violates row-level security policy for table "user_roles"' })
    const onReload = vi.fn()
    montar('company_owner', onReload)
    fireEvent.click(screen.getByRole('button', { name: /Nuevo Usuario/ }))
    await waitFor(() => expect(h.insertUserRoles).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(h.notify).toHaveBeenCalled())
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', title: 'Usuario creado, pero sin permisos', text: expect.stringContaining('row-level security') }))
    expect(h.notify).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }))
    expect(onReload).toHaveBeenCalledTimes(1)                         // la persona SÍ quedó creada: la lista debe mostrarla
  })

  it('«Activar/Desactivar» del propietario: llama a la escritura y recarga; si el servidor devuelve error lo muestra y NO recarga', async () => {
    h.setUsuarioActivo.mockResolvedValueOnce({ error: null })
    const onReload = vi.fn()
    montar('company_owner', onReload)
    const botones = screen.getAllByRole('button', { name: /Desactivar/ }) as HTMLButtonElement[]
    expect(botones[2].disabled).toBe(false)
    fireEvent.click(botones[2])
    await waitFor(() => expect(h.setUsuarioActivo).toHaveBeenCalledWith('u-op', false))
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1))
    h.setUsuarioActivo.mockResolvedValueOnce({ error: 'permission denied' })
    fireEvent.click(botones[2])
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', title: 'No se pudo desactivar', text: 'permission denied' })))
    expect(onReload).toHaveBeenCalledTimes(1)
  })
})

describe('quien NO es el principal y llega a la sección (defensa en profundidad)', () => {
  it('«Nuevo Usuario» está deshabilitado con la explicación y forzar el manejador del botón no abre el diálogo ni crea nada', async () => {
    montar('admin')
    const boton = screen.getByRole('button', { name: /Nuevo Usuario/ }) as HTMLButtonElement
    expect(boton.disabled).toBe(true)
    expect(boton.title).toMatch(/Solo el propietario de la empresa/)
    forzarClick(boton)
    await act(async () => { await Promise.resolve() })
    expect(h.prompt).not.toHaveBeenCalled()
    expect(h.createCompanyUser).not.toHaveBeenCalled()
    expect(h.insertUserRoles).not.toHaveBeenCalled()
  })

  it('«Desactivar»/«Activar» están deshabilitados con la explicación y forzar el manejador no escribe ni recarga (app_users_update es del propietario: sería «0 filas» sin error)', async () => {
    const onReload = vi.fn()
    montar('admin', onReload)
    const botones = screen.getAllByRole('button', { name: /Desactivar/ }) as HTMLButtonElement[]
    expect(botones.every(b => b.disabled)).toBe(true)
    expect(botones[2].title).toMatch(/Solo el propietario de la empresa/)
    forzarClick(botones[2])
    await act(async () => { await Promise.resolve() })
    expect(h.setUsuarioActivo).not.toHaveBeenCalled()
    expect(onReload).not.toHaveBeenCalled()
  })

  it('«Eliminar» (E-07): el administrador lo ve sólo sobre los roles no administrador; el propietario, sobre todos; el operador no lo ve', () => {
    montar('admin')
    // filas: u-yo (admin), u-adm2 (admin), u-op (operator) → un administrador no elimina administradores: sólo la fila del operador
    expect(screen.getAllByRole('button', { name: /Eliminar/ })).toHaveLength(1)
    montar('operator')
    expect(screen.queryAllByRole('button', { name: /Eliminar/ })).toHaveLength(0)
    montar('company_owner')
    expect(screen.getAllByRole('button', { name: /Eliminar/ })).toHaveLength(3)
  })
})
