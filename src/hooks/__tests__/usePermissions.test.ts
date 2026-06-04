import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { usePermissions } from '../usePermissions'
import { EXEMPT_ROLES, NON_CONFIGURABLE_MODULES } from '../../lib/moduleConfig'
import type { UserRole, UserSession } from '../../types'

// ════════════════════════════════════════════════════════════════════════════
// plat:P15 — usePermissions: deriva la visibilidad de módulos del sidebar a
// partir de session.permissions (RBAC). Decide qué módulos/acciones ve el
// personal; era 0% testeado. Fijamos:
//   - bypass de roles exentos (super_admin/company_owner/admin/cliente);
//   - módulos NO configurables siempre visibles (incluso sin sesión);
//   - convención de claves: agua.<m>.<a> (módulos de agua) vs platform.<m>.<a>;
//   - atajos de condominios → claves finas condominios.tab.<id>;
//   - create/edit/change_status exigen además el permiso .view.
// ════════════════════════════════════════════════════════════════════════════

afterEach(cleanup)

function session(role: UserRole, permissions?: string[]): UserSession {
  return {
    user_id: 'u1',
    email: 'u@example.com',
    name: 'Usuaria',
    role,
    login_time: '2026-06-04T00:00:00.000Z',
    expires_at: '2026-06-05T00:00:00.000Z',
    permissions: permissions ? new Set(permissions) : undefined,
  }
}

/** Monta el hook y devuelve su API para la sesión dada. */
function api(s: UserSession | null) {
  return renderHook(() => usePermissions(s)).result.current
}

describe('roles exentos (bypass total)', () => {
  it('cada EXEMPT_ROLE puede ver/crear/editar/cambiar estado en cualquier módulo', () => {
    for (const role of EXEMPT_ROLES) {
      const p = api(session(role))
      expect(p.canViewModule('cobros'), role).toBe(true)
      expect(p.canViewModule('cualquier_modulo'), role).toBe(true)
      expect(p.canCreate('cobros'), role).toBe(true)
      expect(p.canEdit('clientes'), role).toBe(true)
      expect(p.canChangeStatus('tabla'), role).toBe(true)
    }
  })
})

describe('módulos no configurables (siempre visibles)', () => {
  it('visibles para un rol sin permisos e incluso sin sesión', () => {
    const p = api(session('operator')) // sin permisos
    for (const m of NON_CONFIGURABLE_MODULES) expect(p.canViewModule(m), m).toBe(true)
    const anon = api(null)
    expect(anon.canViewModule('perfil')).toBe(true)
  })
})

describe('sesión nula / rol sin permisos (fail-closed)', () => {
  it('no ve módulos configurables ni puede crear', () => {
    const anon = api(null)
    expect(anon.canViewModule('cobros')).toBe(false)
    expect(anon.canCreate('cobros')).toBe(false)
    const operador = api(session('operator'))
    expect(operador.canViewModule('clientes')).toBe(false)
    expect(operador.canEdit('tabla')).toBe(false)
  })
})

describe('módulos de agua → clave agua.<modulo>.<accion>', () => {
  it('view requiere agua.<m>.view', () => {
    expect(api(session('operator', ['agua.cobros.view'])).canViewModule('cobros')).toBe(true)
    expect(api(session('operator', ['agua.tabla.view'])).canViewModule('cobros')).toBe(false)
  })

  it('create/edit/change_status exigen view + la acción', () => {
    const soloView = api(session('operator', ['agua.cobros.view']))
    expect(soloView.canCreate('cobros')).toBe(false)

    const viewYCreate = api(session('operator', ['agua.cobros.view', 'agua.cobros.create']))
    expect(viewYCreate.canCreate('cobros')).toBe(true)

    const tabla = api(session('operator', ['agua.tabla.view', 'agua.tabla.edit']))
    expect(tabla.canEdit('tabla')).toBe(true)
    expect(tabla.canChangeStatus('tabla')).toBe(false)
  })

  it('create sin view → false (no basta la acción suelta)', () => {
    expect(api(session('operator', ['agua.cobros.create'])).canCreate('cobros')).toBe(false)
  })
})

describe('módulos de plataforma → clave platform.<modulo>.<accion>', () => {
  it('clientes/configuracion usan el prefijo platform', () => {
    expect(api(session('operator', ['platform.clientes.view'])).canViewModule('clientes')).toBe(true)
    expect(api(session('viewer', ['platform.configuracion.view'])).canViewModule('configuracion')).toBe(true)
    expect(api(session('operator', ['agua.clientes.view'])).canViewModule('clientes')).toBe(false) // prefijo equivocado
  })
})

describe('atajos de condominios en el sidebar', () => {
  it('condominios_cuotas/visitantes/mantenimiento mapean a condominios.tab.<id>', () => {
    const conCuotas = api(session('operator', ['condominios.tab.cuotas']))
    expect(conCuotas.canViewModule('condominios_cuotas')).toBe(true)
    expect(conCuotas.canViewModule('condominios_visitantes')).toBe(false)

    expect(api(session('operator', ['condominios.tab.visitantes'])).canViewModule('condominios_visitantes')).toBe(true)
  })

  it('condominios_dashboard visible si tiene CUALQUIER tab de condominios', () => {
    expect(api(session('operator', ['condominios.tab.cuotas'])).canViewModule('condominios_dashboard')).toBe(true)
    expect(api(session('operator', ['agua.cobros.view'])).canViewModule('condominios_dashboard')).toBe(false)
  })

  it('el módulo padre "condominios" se ve con platform.condominios.view O con cualquier tab', () => {
    expect(api(session('operator', ['platform.condominios.view'])).canViewModule('condominios')).toBe(true)
    expect(api(session('operator', ['condominios.tab.cuotas'])).canViewModule('condominios')).toBe(true)
    expect(api(session('operator', ['agua.cobros.view'])).canViewModule('condominios')).toBe(false)
  })
})
