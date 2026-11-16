import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { usePermissions } from '../usePermissions'
import type { UserRole, UserSession } from '../../types'

// Manejo de Rentas es un servicio APARTE (companies.servicio_rentas). Lo que
// se fija aquí: sin el servicio no lo ve nadie —tampoco los roles exentos—,
// las claves son rentas.<módulo>.<acción>, el Panel se abre con cualquier
// lectura y escribir exige además `.view`.

afterEach(cleanup)

function session(role: UserRole, servicio: boolean | undefined, permissions?: string[]): UserSession {
  return {
    user_id: 'u1', email: 'u@example.com', name: 'Usuaria', role,
    login_time: '2026-11-16T00:00:00.000Z', expires_at: '2026-11-17T00:00:00.000Z',
    servicio_rentas: servicio,
    permissions: permissions ? new Set(permissions) : undefined,
  }
}
const api = (s: UserSession) => renderHook(() => usePermissions(s)).result.current
const MODULOS = ['rentas_panel', 'rentas_propiedades', 'rentas_reservas', 'rentas_contratos', 'rentas_inventario']

describe('servicio no contratado', () => {
  it.each([false, undefined])('servicio_rentas=%s: ni el dueño ni el admin ven ni escriben', (servicio) => {
    for (const role of ['company_owner', 'admin', 'super_admin'] as UserRole[]) {
      const p = api(session(role, servicio))
      for (const m of MODULOS) {
        expect(p.canViewModule(m), `${role} ${m}`).toBe(false)
        expect(p.canCreate(m)).toBe(false)
        expect(p.canEdit(m)).toBe(false)
        expect(p.canDelete(m)).toBe(false)
      }
      // El resto de la app no cambia para un rol exento.
      expect(p.canViewModule('clientes')).toBe(true)
    }
  })

  it('un operador con las claves otorgadas tampoco, si la empresa no tiene el servicio', () => {
    const p = api(session('operator', false, ['rentas.propiedades.view', 'rentas.propiedades.create']))
    expect(p.canViewModule('rentas_propiedades')).toBe(false)
    expect(p.canViewModule('rentas_panel')).toBe(false)
    expect(p.canCreate('rentas_propiedades')).toBe(false)
  })
})

describe('servicio contratado', () => {
  it('dueño y admin: acceso completo', () => {
    for (const role of ['company_owner', 'admin'] as UserRole[]) {
      const p = api(session(role, true))
      for (const m of MODULOS) expect(p.canViewModule(m)).toBe(true)
      expect(p.canCreate('rentas_reservas')).toBe(true)
      expect(p.canDelete('rentas_inventario')).toBe(true)
    }
  })

  it('el residente (cliente, exento en el portal) no tiene este módulo', () => {
    const p = api(session('cliente', true))
    for (const m of MODULOS) expect(p.canViewModule(m)).toBe(false)
    expect(p.canCreate('rentas_reservas')).toBe(false)
  })

  it('operador: cada módulo con su clave rentas.<módulo>.<acción>; el Panel con cualquier lectura', () => {
    const p = api(session('operator', true, ['rentas.inventario.view', 'rentas.inventario.create', 'rentas.inventario.edit']))
    expect(p.canViewModule('rentas_inventario')).toBe(true)
    expect(p.canViewModule('rentas_panel')).toBe(true)
    expect(p.canViewModule('rentas_propiedades')).toBe(false)
    expect(p.canViewModule('rentas_reservas')).toBe(false)
    expect(p.canCreate('rentas_inventario')).toBe(true)
    expect(p.canEdit('rentas_inventario')).toBe(true)
    expect(p.canDelete('rentas_inventario')).toBe(false)
    expect(p.canCreate('rentas_reservas')).toBe(false)
  })

  it('escribir exige además .view; las claves platform.* no abren Rentas', () => {
    const sinVer = api(session('operator', true, ['rentas.contratos.create']))
    expect(sinVer.canViewModule('rentas_contratos')).toBe(false)
    expect(sinVer.canCreate('rentas_contratos')).toBe(false)
    expect(sinVer.canViewModule('rentas_panel')).toBe(false)
    const plataforma = api(session('operator', true, ['platform.rentas_contratos.view', 'platform.condominios.view']))
    expect(plataforma.canViewModule('rentas_contratos')).toBe(false)
  })

  it('sin ningún permiso de Rentas no ve el grupo', () => {
    const p = api(session('operator', true, ['agua.cobros.view', 'condominios.tab.str']))
    for (const m of MODULOS) expect(p.canViewModule(m)).toBe(false)
  })
})
