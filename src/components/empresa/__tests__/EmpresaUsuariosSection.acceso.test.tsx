// Lista de usuarios de la empresa: los botones «Acceso» (asignar proyectos) y «Roles y permisos», y quién puede usarlos sobre quién.
//
// Decisión del dueño del negocio (2026-10-11): sólo el PRINCIPAL de la empresa (propietario o superadministrador) asigna proyectos, permisos y administradores. Un
// administrador (acotado o exento) NO cambia los proyectos de nadie —ni los suyos (ampliaría su alcance o, borrándolos, pasaría a ser «exento de proyecto») ni los ajenos—
// y no asigna roles ni llaves. El servidor lo rechaza (migraciones 20261026000600 y 20261026000700); aquí la pantalla no ofrece lo que será rechazado y explica por qué.
// El propietario y el superadministrador sí pueden, también con su propia fila. (La pantalla /empresa sólo la abre el propietario: son compuertas de defensa en profundidad.)
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { useEffect } from 'react'

const montajes = vi.hoisted(() => ({ ids: [] as string[], desmontajes: [] as string[] }))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}), auth: {} } }))
// El modal simulado expone sus callbacks con botones (fuera del div con el texto, que otras pruebas comparan exacto): así se comprueba que la Sección
// se los PASA y que cada uno recarga la lista de atrás (F2-08: M19 «no cablea onReload», M20 «no recarga tras guardar»).
vi.mock('../AsignacionModal', () => ({
  AsignacionModal: (p: { usuario: { id: string }; actor?: { id: string; role: string }; onSaved?: () => void; onReload?: () => void }) => {
    // cuenta cuántas veces se MONTA (y desmonta) el modal: cambiar de persona debe remontarlo (H3 de la ronda 4, `key={usuario.id}` en la Sección)
    useEffect(() => {
      montajes.ids.push(p.usuario.id)
      return () => { montajes.desmontajes.push(p.usuario.id) }
    }, [])
    return (
      <>
        <div data-testid="modal-asignacion">{`${p.usuario.id}|${p.actor?.id}|${p.actor?.role}`}</div>
        <button type="button" data-testid="modal-simula-guardado" onClick={() => p.onSaved?.()}>simula guardado</button>
        <button type="button" data-testid="modal-simula-parcial" onClick={() => p.onReload?.()}>simula parcial</button>
      </>
    )
  },
}))
vi.mock('../RolPermisosModal', () => ({ RolPermisosModal: () => null }))
vi.mock('../CustomRoleEditor', () => ({ CustomRoleEditor: () => null }))
vi.mock('../AuditLogModal', () => ({ AuditLogModal: () => null }))
vi.mock('../FinancialAuditModal', () => ({ FinancialAuditModal: () => null }))
vi.mock('../PapeleraModal', () => ({ PapeleraModal: () => null }))
vi.mock('../SavedReportsModal', () => ({ SavedReportsModal: () => null }))

import { EmpresaUsuariosSection } from '../EmpresaUsuariosSection'
import { MOTIVO_AUTOASIGNACION, MOTIVO_SOLO_PRINCIPAL } from '../../../domain/empresa/usuarios'

const USUARIOS = [
  { id: 'u-yo', full_name: 'Yo Mismo', role: 'admin', activo: true },
  { id: 'u-otro', full_name: 'Otra Persona', role: 'operator', activo: true },
]

function montar(rol: string, onReload: () => void = () => {}) {
  cleanup()
  render(
    <EmpresaUsuariosSection
      currentUser={{ user_id: 'u-yo', email: '', name: 'Yo Mismo', role: rol, company_id: 'c1', login_time: '', expires_at: '' } as never}
      usuarios={USUARIOS}
      proyectos={[]}
      onReload={onReload}
    />,
  )
  return screen.getAllByRole('button', { name: /Acceso/ }) as HTMLButtonElement[]
}

beforeEach(() => { cleanup(); montajes.ids = []; montajes.desmontajes = [] })

describe('EmpresaUsuariosSection · botón Acceso', () => {
  it('un administrador NO puede abrir los proyectos de SU fila (deshabilitado, con la explicación de la autoedición)', () => {
    const [propio] = montar('admin')
    expect(propio.disabled).toBe(true)
    expect(propio.title).toBe(MOTIVO_AUTOASIGNACION)
    expect(propio.title).toMatch(/No puedes cambiar tus propios proyectos/)
    expect(screen.getByText(MOTIVO_AUTOASIGNACION)).toBeTruthy()
  })

  it('un administrador tampoco puede abrir los proyectos de OTRA persona: deshabilitado, con «solo el propietario», y el clic no abre el modal', () => {
    const [, ajeno] = montar('admin')
    expect(ajeno.disabled).toBe(true)
    expect(ajeno.title).toBe(MOTIVO_SOLO_PRINCIPAL)
    expect(screen.getAllByText(MOTIVO_SOLO_PRINCIPAL).length).toBeGreaterThan(0)
    fireEvent.click(ajeno)
    expect(screen.queryByTestId('modal-asignacion')).toBeNull()
    expect(montajes.ids).toEqual([])
  })

  it.each(['company_owner', 'super_admin', 'superadmin'])('%s sí abre los proyectos de OTRA persona, y el modal recibe quién edita', rol => {
    const [, ajeno] = montar(rol)
    expect(ajeno.disabled).toBe(false)
    fireEvent.click(ajeno)
    const modal = screen.getByTestId('modal-asignacion')
    expect(within(modal).getByText(`u-otro|u-yo|${rol}`)).toBeTruthy()
  })

  it.each(['company_owner', 'super_admin'])('%s sí puede abrir los proyectos de SU propia fila (es exento)', rol => {
    const [propio] = montar(rol)
    expect(propio.disabled).toBe(false)
    expect(screen.queryByText(MOTIVO_AUTOASIGNACION)).toBeNull()
    expect(screen.queryByText(MOTIVO_SOLO_PRINCIPAL)).toBeNull()
    fireEvent.click(propio)
    expect(screen.getByTestId('modal-asignacion').textContent).toBe(`u-yo|u-yo|${rol}`)
  })
})

describe('EmpresaUsuariosSection · botón «Roles y permisos»: sólo el principal asigna roles y llaves', () => {
  const rolesYPermisos = () => screen.getAllByRole('button', { name: /Roles y permisos/ }) as HTMLButtonElement[]

  it('un administrador lo ve deshabilitado en todas las filas, con la explicación', () => {
    montar('admin')
    const botones = rolesYPermisos()
    expect(botones).toHaveLength(2)
    for (const b of botones) {
      expect(b.disabled).toBe(true)
      expect(b.title).toBe('Solo el propietario de la empresa asigna permisos.')
    }
  })

  it.each(['operator', 'viewer', 'collector'])('un %s tampoco', rol => {
    montar(rol)
    for (const b of rolesYPermisos()) expect(b.disabled).toBe(true)
  })

  it.each(['company_owner', 'super_admin', 'superadmin'])('%s lo tiene habilitado', rol => {
    montar(rol)
    for (const b of rolesYPermisos()) {
      expect(b.disabled).toBe(false)
      expect(b.title).toMatch(/Roles y permisos/)
    }
  })

  it('el aviso de «Personalización fina de permisos» es del principal; el administrador ve que sólo el propietario asigna permisos', () => {
    montar('company_owner')
    expect(screen.getByText(/Personalización fina de permisos/)).toBeTruthy()
    expect(screen.queryByRole('note')).toBeNull()
    montar('admin')
    expect(screen.queryByText(/Personalización fina de permisos/)).toBeNull()
    expect(screen.getByRole('note').textContent).toContain(MOTIVO_SOLO_PRINCIPAL)
  })
})

describe('EmpresaUsuariosSection · lo que le pasa al modal de asignaciones (F2-08)', () => {
  it('M20 · tras un guardado completo (onSaved) la Sección recarga la lista de usuarios', () => {
    const onReload = vi.fn()
    const [, ajeno] = montar('company_owner', onReload)
    fireEvent.click(ajeno)
    expect(onReload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('modal-simula-guardado'))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('M19 · tras un guardado PARCIAL (onReload del modal) la Sección también recarga: la lista de atrás debe reflejar lo que sí se aplicó', () => {
    const onReload = vi.fn()
    const [, ajeno] = montar('company_owner', onReload)
    fireEvent.click(ajeno)
    fireEvent.click(screen.getByTestId('modal-simula-parcial'))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('M23 · el botón «Acceso» deshabilitado apunta (aria-describedby) a la explicación; los habilitados no llevan ese atributo', () => {
    const [propio, ajeno] = montar('admin')
    expect(document.getElementById(propio.getAttribute('aria-describedby') as string)?.textContent).toBe(MOTIVO_AUTOASIGNACION)
    expect(document.getElementById(ajeno.getAttribute('aria-describedby') as string)?.textContent).toBe(MOTIVO_SOLO_PRINCIPAL)
    const [propioP, ajenoP] = montar('company_owner')
    expect(propioP.hasAttribute('aria-describedby')).toBe(false)
    expect(ajenoP.hasAttribute('aria-describedby')).toBe(false)
  })
})

describe('EmpresaUsuariosSection · cambiar de persona REMONTA el modal de asignaciones (H3, ronda 4)', () => {
  // El modal conserva su estado (casillas, `inicial`, «guardando») entre renders. Si el padre le cambiara `usuario` sin desmontarlo, durante un render quedarían las casillas de
  // la persona anterior bajo el nombre de la nueva y un clic en Guardar escribiría la selección de A sobre B (la ventana medida por el verificador). La app hoy no lo hace (el
  // fondo del modal tapa los botones «Acceso»), pero la defensa estructural es `key={usuario.id}`: otra persona = otra instancia, con el estado de cero.
  const TRES = [
    { id: 'u-yo', full_name: 'Yo Mismo', role: 'company_owner', activo: true },
    { id: 'u-a', full_name: 'Persona A', role: 'operator', activo: true },
    { id: 'u-b', full_name: 'Persona B', role: 'operator', activo: true },
  ]
  function montarTres() {
    render(
      <EmpresaUsuariosSection
        currentUser={{ user_id: 'u-yo', email: '', name: 'Yo Mismo', role: 'company_owner', company_id: 'c1', login_time: '', expires_at: '' } as never}
        usuarios={TRES}
        proyectos={[]}
        onReload={() => {}}
      />,
    )
    return screen.getAllByRole('button', { name: /Acceso/ }) as HTMLButtonElement[]
  }

  it('abrir A y luego B (sin cerrar) desmonta la instancia de A y monta otra para B', () => {
    const [, a, b] = montarTres()
    fireEvent.click(a)
    expect(screen.getByTestId('modal-asignacion').textContent).toBe('u-a|u-yo|company_owner')
    expect(montajes.ids).toEqual(['u-a'])
    fireEvent.click(b)
    expect(screen.getByTestId('modal-asignacion').textContent).toBe('u-b|u-yo|company_owner')
    expect(montajes.desmontajes).toEqual(['u-a'])           // A se desmontó…
    expect(montajes.ids).toEqual(['u-a', 'u-b'])            // …y B es una instancia NUEVA
  })

  it('volver a abrir a la MISMA persona (sin cerrar) no remonta: mismo `key`, mismo estado', () => {
    const [, a] = montarTres()
    fireEvent.click(a)
    fireEvent.click(a)
    expect(montajes.ids).toEqual(['u-a'])
    expect(montajes.desmontajes).toEqual([])
  })
})
