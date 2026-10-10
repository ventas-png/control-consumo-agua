// Lista de usuarios de la empresa: el botón «Acceso» (asignar proyectos) y quién puede usarlo sobre quién.
//
// Un administrador (que no es propietario ni superadministrador) NO cambia sus propios proyectos: ampliaría su alcance o, borrando
// los suyos, pasaría a ser «exento de proyecto» (ve toda la empresa). El servidor lo rechaza (migración 20261026000600); aquí la
// pantalla no ofrece lo que será rechazado y explica por qué. El propietario y el superadministrador sí pueden con su fila.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}), auth: {} } }))
vi.mock('../AsignacionModal', () => ({
  AsignacionModal: (p: { usuario: { id: string }; actor?: { id: string; role: string } }) => (
    <div data-testid="modal-asignacion">{`${p.usuario.id}|${p.actor?.id}|${p.actor?.role}`}</div>
  ),
}))
vi.mock('../RolPermisosModal', () => ({ RolPermisosModal: () => null }))
vi.mock('../CustomRoleEditor', () => ({ CustomRoleEditor: () => null }))
vi.mock('../AuditLogModal', () => ({ AuditLogModal: () => null }))
vi.mock('../FinancialAuditModal', () => ({ FinancialAuditModal: () => null }))
vi.mock('../PapeleraModal', () => ({ PapeleraModal: () => null }))
vi.mock('../SavedReportsModal', () => ({ SavedReportsModal: () => null }))

import { EmpresaUsuariosSection } from '../EmpresaUsuariosSection'

const USUARIOS = [
  { id: 'u-yo', full_name: 'Yo Mismo', role: 'admin', activo: true },
  { id: 'u-otro', full_name: 'Otra Persona', role: 'operator', activo: true },
]

function montar(rol: string) {
  cleanup()
  render(
    <EmpresaUsuariosSection
      currentUser={{ user_id: 'u-yo', email: '', name: 'Yo Mismo', role: rol, company_id: 'c1', login_time: '', expires_at: '' } as never}
      usuarios={USUARIOS}
      proyectos={[]}
      onReload={() => {}}
    />,
  )
  return screen.getAllByRole('button', { name: /Acceso/ }) as HTMLButtonElement[]
}

beforeEach(() => cleanup())

describe('EmpresaUsuariosSection · botón Acceso', () => {
  it('un administrador NO puede abrir los proyectos de SU fila (deshabilitado, con la explicación)', () => {
    const [propio, ajeno] = montar('admin')
    expect(propio.disabled).toBe(true)
    expect(propio.title).toMatch(/No puedes cambiar tus propios proyectos/)
    expect(screen.getByText(/Tus proyectos los cambia otro administrador, el propietario o el superadministrador/)).toBeTruthy()
    expect(ajeno.disabled).toBe(false)
  })

  it('un administrador sí abre los proyectos de OTRA persona, y el modal recibe quién edita', () => {
    const [, ajeno] = montar('admin')
    fireEvent.click(ajeno)
    const modal = screen.getByTestId('modal-asignacion')
    expect(within(modal).getByText('u-otro|u-yo|admin')).toBeTruthy()
  })

  it.each(['company_owner', 'super_admin'])('%s sí puede abrir los proyectos de SU propia fila (es exento)', rol => {
    const [propio] = montar(rol)
    expect(propio.disabled).toBe(false)
    expect(screen.queryByText(/Tus proyectos los cambia otro administrador/)).toBeNull()
    fireEvent.click(propio)
    expect(screen.getByTestId('modal-asignacion').textContent).toBe(`u-yo|u-yo|${rol}`)
  })
})
