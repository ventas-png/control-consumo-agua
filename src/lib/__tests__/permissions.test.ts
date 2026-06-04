import { describe, it, expect } from 'vitest'
import {
  isExemptPlatformRole,
  hasPermission,
  hasAnyPermission,
  condominiosTabPermission,
  getDisplayRoleLabel,
  getDisplayRoleColor,
  canViewCondominiosTabByPermission,
  PLATFORM_ROLE_LABELS,
  PLATFORM_ROLE_COLORS,
} from '../permissions'
import type { AssignedRoleInfo, UserRole, UserSession } from '../../types'

// ════════════════════════════════════════════════════════════════════════════
// plat:P15 — Capa de autorización del cliente (RBAC). Lógica PURA, sin red.
//
// permissions.ts es el gate de UI que decide qué ve/puede el usuario. Era código
// crítico SIN tests; aquí fijamos su contrato:
//   - el bypass de roles exentos (super_admin/company_owner/admin) — el mismo
//     conjunto que la BD (user_has_permission) y moduleConfig (drift guard);
//   - la consulta del Set de permisos para roles NO exentos;
//   - la elección de la etiqueta/color de rol más específico (condominios>agua>general).
// ════════════════════════════════════════════════════════════════════════════

const ALL_PLATFORM_ROLES: UserRole[] = [
  'super_admin', 'company_owner', 'admin', 'operator', 'viewer', 'cliente', 'collector',
]
const EXEMPT: UserRole[] = ['super_admin', 'company_owner', 'admin']
const NO_EXENTOS: UserRole[] = ['operator', 'viewer', 'cliente', 'collector']

/** UserSession mínima; cada test sobreescribe lo que necesita. */
function session(over: Partial<UserSession> = {}): UserSession {
  return {
    user_id: 'u1',
    email: 'u@example.com',
    name: 'Usuaria',
    role: 'operator',
    login_time: '2026-06-04T00:00:00.000Z',
    expires_at: '2026-06-05T00:00:00.000Z',
    ...over,
  }
}

function assignedRole(over: Partial<AssignedRoleInfo> = {}): AssignedRoleInfo {
  return { id: 'r1', name: 'Rol', service: null, color: null, ...over }
}

describe('isExemptPlatformRole', () => {
  it('true solo para super_admin / company_owner / admin', () => {
    for (const r of EXEMPT) expect(isExemptPlatformRole(r)).toBe(true)
  })

  it('false para roles no exentos', () => {
    for (const r of NO_EXENTOS) expect(isExemptPlatformRole(r)).toBe(false)
  })

  it('false para null / undefined / vacío / desconocido', () => {
    expect(isExemptPlatformRole(null)).toBe(false)
    expect(isExemptPlatformRole(undefined)).toBe(false)
    expect(isExemptPlatformRole('')).toBe(false)
    expect(isExemptPlatformRole('superadmin')).toBe(false) // typo no cuenta
  })
})

describe('hasPermission', () => {
  it('sin sesión (null/undefined) → false', () => {
    expect(hasPermission(null, 'condominios.tab.cuotas')).toBe(false)
    expect(hasPermission(undefined, 'condominios.tab.cuotas')).toBe(false)
  })

  it('rol exento → true aunque NO tenga el permiso (ni Set de permisos)', () => {
    const s = session({ role: 'admin' }) // sin permissions
    expect(hasPermission(s, 'cualquier.cosa')).toBe(true)
    expect(hasPermission(session({ role: 'super_admin', permissions: new Set() }), 'x')).toBe(true)
  })

  it('rol NO exento → true solo si el Set contiene la clave', () => {
    const s = session({ role: 'operator', permissions: new Set(['condominios.tab.cuotas']) })
    expect(hasPermission(s, 'condominios.tab.cuotas')).toBe(true)
    expect(hasPermission(s, 'condominios.tab.visitantes')).toBe(false)
  })

  it('rol NO exento sin Set de permisos → false', () => {
    expect(hasPermission(session({ role: 'viewer' }), 'condominios.tab.cuotas')).toBe(false)
  })
})

describe('hasAnyPermission', () => {
  it('sin sesión → false', () => {
    expect(hasAnyPermission(null, ['a', 'b'])).toBe(false)
  })

  it('rol exento → true (corta antes de mirar las claves, incluso con lista vacía)', () => {
    expect(hasAnyPermission(session({ role: 'admin' }), [])).toBe(true)
    expect(hasAnyPermission(session({ role: 'company_owner' }), ['a'])).toBe(true)
  })

  it('rol NO exento → true si tiene ALGUNA de las claves', () => {
    const s = session({ role: 'operator', permissions: new Set(['agua.cobros.view']) })
    expect(hasAnyPermission(s, ['agua.cobros.view', 'agua.cobros.edit'])).toBe(true)
  })

  it('rol NO exento → false si no tiene ninguna, o con lista vacía, o sin Set', () => {
    const s = session({ role: 'operator', permissions: new Set(['agua.cobros.view']) })
    expect(hasAnyPermission(s, ['agua.cobros.edit', 'agua.cobros.create'])).toBe(false)
    expect(hasAnyPermission(s, [])).toBe(false)
    expect(hasAnyPermission(session({ role: 'operator' }), ['agua.cobros.view'])).toBe(false)
  })
})

describe('condominiosTabPermission', () => {
  it('construye la clave condominios.tab.<id>', () => {
    expect(condominiosTabPermission('cuotas')).toBe('condominios.tab.cuotas')
    expect(condominiosTabPermission('visitantes')).toBe('condominios.tab.visitantes')
  })
})

describe('getDisplayRoleLabel', () => {
  it('sin sesión → cadena vacía', () => {
    expect(getDisplayRoleLabel(null)).toBe('')
    expect(getDisplayRoleLabel(undefined)).toBe('')
  })

  it('sin roles asignados → etiqueta del rol de plataforma', () => {
    expect(getDisplayRoleLabel(session({ role: 'operator' }))).toBe('Operador')
    expect(getDisplayRoleLabel(session({ role: 'collector' }))).toBe('Gestor de Cobros')
    expect(getDisplayRoleLabel(session({ role: 'operator', assigned_roles: [] }))).toBe('Operador')
  })

  it('prefiere el rol asignado más específico: condominios > agua > general', () => {
    const s = session({
      role: 'operator',
      assigned_roles: [
        assignedRole({ name: 'Finanzas', service: 'agua' }),
        assignedRole({ name: 'Junta Directiva', service: 'condominios' }),
        assignedRole({ name: 'General', service: 'general' }),
      ],
    })
    expect(getDisplayRoleLabel(s)).toBe('Junta Directiva')
  })

  it('entre agua y general gana agua', () => {
    const s = session({
      role: 'viewer',
      assigned_roles: [
        assignedRole({ name: 'Gen', service: 'general' }),
        assignedRole({ name: 'Cobros Agua', service: 'agua' }),
      ],
    })
    expect(getDisplayRoleLabel(s)).toBe('Cobros Agua')
  })

  it('un rol con service null (score 0) igual se muestra si es el único', () => {
    const s = session({ role: 'operator', assigned_roles: [assignedRole({ name: 'Custom', service: null })] })
    expect(getDisplayRoleLabel(s)).toBe('Custom')
  })
})

describe('getDisplayRoleColor', () => {
  it('sin sesión → color por defecto', () => {
    expect(getDisplayRoleColor(null)).toBe('#7E9389')
  })

  it('sin roles asignados → color del rol de plataforma', () => {
    expect(getDisplayRoleColor(session({ role: 'operator' }))).toBe(PLATFORM_ROLE_COLORS.operator)
    expect(getDisplayRoleColor(session({ role: 'collector' }))).toBe('#f59e0b')
  })

  it('rol asignado con color → usa ese color', () => {
    const s = session({ role: 'operator', assigned_roles: [assignedRole({ service: 'condominios', color: '#123456' })] })
    expect(getDisplayRoleColor(s)).toBe('#123456')
  })

  it('rol asignado SIN color → cae al color del rol de plataforma', () => {
    const s = session({ role: 'operator', assigned_roles: [assignedRole({ service: 'condominios', color: null })] })
    expect(getDisplayRoleColor(s)).toBe(PLATFORM_ROLE_COLORS.operator)
  })
})

describe('canViewCondominiosTabByPermission', () => {
  it('delega en hasPermission con la clave condominios.tab.<id>', () => {
    const s = session({ role: 'operator', permissions: new Set(['condominios.tab.cuotas']) })
    expect(canViewCondominiosTabByPermission(s, 'cuotas')).toBe(true)
    expect(canViewCondominiosTabByPermission(s, 'visitantes')).toBe(false)
  })

  it('rol exento ve cualquier tab; sin sesión no ve nada', () => {
    expect(canViewCondominiosTabByPermission(session({ role: 'admin' }), 'lo_que_sea')).toBe(true)
    expect(canViewCondominiosTabByPermission(null, 'cuotas')).toBe(false)
  })
})

describe('mapas de etiquetas/colores de rol (drift guards)', () => {
  it('cada UserRole tiene etiqueta y color definidos y no vacíos', () => {
    for (const r of ALL_PLATFORM_ROLES) {
      expect(PLATFORM_ROLE_LABELS[r], `label de ${r}`).toBeTruthy()
      expect(PLATFORM_ROLE_COLORS[r], `color de ${r}`).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })
})
