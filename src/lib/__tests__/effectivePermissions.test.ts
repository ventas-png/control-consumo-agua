// Tests del cálculo puro de permisos efectivos del modal de roles. La
// referencia de semántica es get_user_permissions (20260518000008): unión de
// allows menos unión de denies; un deny gana siempre.
import { describe, it, expect } from 'vitest'
import {
  buildRolePermIndex,
  computeEffective,
  groupStatus,
} from '../effectivePermissions'

const rows = [
  { role_id: 'r1', permission_key: 'agua.lecturas.view', effect: 'allow' },
  { role_id: 'r1', permission_key: 'agua.lecturas.create', effect: 'allow' },
  { role_id: 'r2', permission_key: 'agua.lecturas.view', effect: 'allow' },
  { role_id: 'r2', permission_key: 'agua.cobros.view', effect: 'allow' },
  { role_id: 'r3', permission_key: 'agua.cobros.view', effect: 'deny' },
  { role_id: 'r3', permission_key: 'agua.tarifas.view', effect: 'otro' }, // effect basura → ignorado
]

describe('buildRolePermIndex', () => {
  it('separa allow/deny por rol e ignora effects desconocidos', () => {
    const idx = buildRolePermIndex(rows)
    expect(idx.allows.get('r1')).toEqual(new Set(['agua.lecturas.view', 'agua.lecturas.create']))
    expect(idx.denies.get('r3')).toEqual(new Set(['agua.cobros.view']))
    expect(idx.allows.get('r3')).toBeUndefined()
  })
})

describe('computeEffective — solo roles', () => {
  const idx = buildRolePermIndex(rows)

  it('unión de allows de los roles seleccionados', () => {
    const { effective, base } = computeEffective(new Set(['r1', 'r2']), idx)
    expect(effective).toEqual(new Set(['agua.lecturas.view', 'agua.lecturas.create', 'agua.cobros.view']))
    expect(base).toEqual(effective)
  })

  it('un deny de cualquier rol seleccionado resta del efectivo', () => {
    const { effective } = computeEffective(new Set(['r2', 'r3']), idx)
    expect(effective).toEqual(new Set(['agua.lecturas.view']))
  })

  it('roles no seleccionados no aportan', () => {
    const { effective } = computeEffective(new Set(['r1']), idx)
    expect(effective.has('agua.cobros.view')).toBe(false)
  })

  it('atribución: grantedBy lista los roles que otorgan cada clave', () => {
    const { grantedBy } = computeEffective(new Set(['r1', 'r2']), idx)
    expect(new Set(grantedBy.get('agua.lecturas.view'))).toEqual(new Set(['r1', 'r2']))
    expect(grantedBy.get('agua.cobros.view')).toEqual(['r2'])
  })
})

describe('computeEffective — ajustes individuales (overrides)', () => {
  const idx = buildRolePermIndex(rows)

  it('allow de ajuste agrega una clave que ningún rol otorga', () => {
    const ov = new Map([['agua.mapa.view', 'allow' as const]])
    const { effective, overriddenKeys, redundantOverrides } = computeEffective(new Set(['r1']), idx, ov)
    expect(effective.has('agua.mapa.view')).toBe(true)
    expect(overriddenKeys).toEqual(new Set(['agua.mapa.view']))
    expect(redundantOverrides.size).toBe(0)
  })

  it('deny de ajuste bloquea una clave otorgada por rol', () => {
    const ov = new Map([['agua.lecturas.create', 'deny' as const]])
    const { effective, overriddenKeys } = computeEffective(new Set(['r1']), idx, ov)
    expect(effective.has('agua.lecturas.create')).toBe(false)
    expect(effective.has('agua.lecturas.view')).toBe(true)
    expect(overriddenKeys).toEqual(new Set(['agua.lecturas.create']))
  })

  it('allow redundante (ya otorgado por rol) no cambia nada y se marca', () => {
    const ov = new Map([['agua.lecturas.view', 'allow' as const]])
    const { effective, overriddenKeys, redundantOverrides } = computeEffective(new Set(['r1']), idx, ov)
    expect(effective.has('agua.lecturas.view')).toBe(true)
    expect(overriddenKeys.size).toBe(0)
    expect(redundantOverrides).toEqual(new Set(['agua.lecturas.view']))
  })

  it('deny redundante (nadie la otorga) se marca para poda', () => {
    const ov = new Map([['agua.rutas.view', 'deny' as const]])
    const { redundantOverrides, overriddenKeys } = computeEffective(new Set(['r1']), idx, ov)
    expect(redundantOverrides).toEqual(new Set(['agua.rutas.view']))
    expect(overriddenKeys.size).toBe(0)
  })

  it('allow de ajuste NO vence un deny de rol (semántica del servidor)', () => {
    const ov = new Map([['agua.cobros.view', 'allow' as const]])
    const { effective, redundantOverrides } = computeEffective(new Set(['r2', 'r3']), idx, ov)
    expect(effective.has('agua.cobros.view')).toBe(false)
    expect(redundantOverrides).toEqual(new Set(['agua.cobros.view']))
  })
})

describe('groupStatus', () => {
  const groups = [
    { key: 'g1', label: 'Lecturas', tabs: ['agua.lecturas.view', 'agua.lecturas.create'] },
    { key: 'g2', label: 'Cobros', tabs: ['agua.cobros.view', 'agua.cobros.create'] },
    { key: 'g3', label: 'Mapa', tabs: ['agua.mapa.view'] },
  ]

  it('deriva completo / parcial N/total / ninguno', () => {
    const effective = new Set(['agua.lecturas.view', 'agua.lecturas.create', 'agua.cobros.view'])
    expect(groupStatus(effective, groups)).toEqual([
      { key: 'g1', label: 'Lecturas', level: 'completo', count: 2, total: 2 },
      { key: 'g2', label: 'Cobros', level: 'parcial', count: 1, total: 2 },
      { key: 'g3', label: 'Mapa', level: 'ninguno', count: 0, total: 1 },
    ])
  })
})
