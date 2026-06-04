import { describe, it, expect } from 'vitest'
import {
  canViewCondominiosTab,
  getEffectiveTabAccess,
  canViewCondominiosTabMulti,
  CONDOMINIOS_ROLES,
  CONDOMINIOS_TAB_ACCESS,
} from '../condominiosRoles'
import type { CondominiosRole } from '../../types'

// ════════════════════════════════════════════════════════════════════════════
// plat:P15 — RBAC de condominios (visibilidad de tabs por rol). Lógica PURA.
//
// Modelo: cada rol mapea a un Set de tab_ids permitidos; `null` = acceso total
// (administrador_general / usuario exento). Aquí fijamos:
//   - el gating por rol único y multi-rol (unión de Sets);
//   - el caso fail-closed de "sin roles" (Set vacío → no ve nada);
//   - drift guards: cada rol declarado tiene su entrada en el mapa de acceso.
// ════════════════════════════════════════════════════════════════════════════

// Tabs representativas de cada sección (verificadas contra CONDOMINIOS_TAB_ACCESS).
const TAB_FINANZAS = 'cuotas'
const TAB_SEGURIDAD = 'visitantes'
const TAB_OPERACIONES = 'mantenimiento'
const TAB_PANEL = 'panel'

describe('canViewCondominiosTab (rol único)', () => {
  it('sin rol (null/undefined) → acceso total', () => {
    expect(canViewCondominiosTab(TAB_FINANZAS, null)).toBe(true)
    expect(canViewCondominiosTab('cualquier_cosa', undefined)).toBe(true)
  })

  it('administrador_general (acceso null) → ve cualquier tab, incluso desconocida', () => {
    expect(canViewCondominiosTab(TAB_SEGURIDAD, 'administrador_general')).toBe(true)
    expect(canViewCondominiosTab('tab_inventada', 'administrador_general')).toBe(true)
  })

  it('finanzas ve finanzas pero NO seguridad', () => {
    expect(canViewCondominiosTab(TAB_FINANZAS, 'finanzas')).toBe(true)
    expect(canViewCondominiosTab('presupuesto', 'finanzas')).toBe(true)
    expect(canViewCondominiosTab(TAB_SEGURIDAD, 'finanzas')).toBe(false)
  })

  it('seguridad ve seguridad pero NO finanzas', () => {
    expect(canViewCondominiosTab(TAB_SEGURIDAD, 'seguridad')).toBe(true)
    expect(canViewCondominiosTab(TAB_FINANZAS, 'seguridad')).toBe(false)
  })

  it('visualizador solo ve panel/reportes, no operaciones ni cobros', () => {
    expect(canViewCondominiosTab(TAB_PANEL, 'visualizador')).toBe(true)
    expect(canViewCondominiosTab(TAB_FINANZAS, 'visualizador')).toBe(false)
    expect(canViewCondominiosTab(TAB_OPERACIONES, 'visualizador')).toBe(false)
  })

  it('recepción ve paquetería pero no presupuesto', () => {
    expect(canViewCondominiosTab('paqueteria', 'recepcion')).toBe(true)
    expect(canViewCondominiosTab('presupuesto', 'recepcion')).toBe(false)
  })
})

describe('getEffectiveTabAccess (multi-rol)', () => {
  it('sin roles → Set vacío (fail-closed: no ve nada)', () => {
    const access = getEffectiveTabAccess([])
    expect(access).not.toBeNull()
    expect(access!.size).toBe(0)
  })

  it('administrador_general en la lista → null (acceso total), aunque haya otros', () => {
    expect(getEffectiveTabAccess(['administrador_general'])).toBeNull()
    expect(getEffectiveTabAccess(['finanzas', 'administrador_general'])).toBeNull()
  })

  it('un solo rol → su propio Set de acceso', () => {
    const access = getEffectiveTabAccess(['visualizador'])
    expect(access).not.toBeNull()
    expect(access!.has(TAB_PANEL)).toBe(true)
    expect(access!.has(TAB_FINANZAS)).toBe(false)
  })

  it('varios roles → UNIÓN de sus Sets', () => {
    const access = getEffectiveTabAccess(['finanzas', 'seguridad'])
    expect(access).not.toBeNull()
    expect(access!.has(TAB_FINANZAS)).toBe(true) // de finanzas
    expect(access!.has(TAB_SEGURIDAD)).toBe(true) // de seguridad
  })
})

describe('canViewCondominiosTabMulti', () => {
  it('roles null → usuario exento, ve todo', () => {
    expect(canViewCondominiosTabMulti(TAB_FINANZAS, null)).toBe(true)
  })

  it('lista vacía → no ve nada (fail-closed)', () => {
    expect(canViewCondominiosTabMulti(TAB_PANEL, [])).toBe(false)
  })

  it('administrador_general → ve cualquier tab', () => {
    expect(canViewCondominiosTabMulti('tab_inventada', ['administrador_general'])).toBe(true)
  })

  it('combina permisos de varios roles (unión)', () => {
    const roles: CondominiosRole[] = ['finanzas', 'seguridad']
    expect(canViewCondominiosTabMulti(TAB_FINANZAS, roles)).toBe(true)
    expect(canViewCondominiosTabMulti(TAB_SEGURIDAD, roles)).toBe(true)
    expect(canViewCondominiosTabMulti(TAB_OPERACIONES, roles)).toBe(false)
  })

  it('un rol restringido no ve tabs fuera de su set', () => {
    expect(canViewCondominiosTabMulti(TAB_FINANZAS, ['visualizador'])).toBe(false)
  })
})

describe('catálogo de roles vs mapa de acceso (drift guards)', () => {
  it('cada rol declarado en CONDOMINIOS_ROLES tiene entrada en CONDOMINIOS_TAB_ACCESS', () => {
    for (const def of CONDOMINIOS_ROLES) {
      expect(CONDOMINIOS_TAB_ACCESS, `falta acceso para ${def.id}`).toHaveProperty(def.id)
    }
  })

  it('el mapa de acceso no tiene roles huérfanos (sin definición)', () => {
    const declarados = new Set(CONDOMINIOS_ROLES.map((r) => r.id))
    for (const id of Object.keys(CONDOMINIOS_TAB_ACCESS)) {
      expect(declarados.has(id as CondominiosRole), `rol huérfano en el mapa: ${id}`).toBe(true)
    }
  })

  it('administrador_general es el único con acceso total (null)', () => {
    expect(CONDOMINIOS_TAB_ACCESS.administrador_general).toBeNull()
    const conAccesoTotal = Object.entries(CONDOMINIOS_TAB_ACCESS)
      .filter(([, set]) => set === null)
      .map(([id]) => id)
    expect(conAccesoTotal).toEqual(['administrador_general'])
  })

  it('los roles restringidos tienen Sets no vacíos', () => {
    for (const [id, set] of Object.entries(CONDOMINIOS_TAB_ACCESS)) {
      if (id === 'administrador_general') continue
      expect(set, `set vacío para ${id}`).not.toBeNull()
      expect((set as Set<string>).size).toBeGreaterThan(0)
    }
  })
})
