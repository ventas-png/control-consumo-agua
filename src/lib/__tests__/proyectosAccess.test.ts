import { describe, it, expect } from 'vitest'
import {
  isProjectExempt,
  filterProyectosByAssignment,
  deriveProyectoConfig,
} from '../proyectosAccess'
import { SYSTEM_ROLE_IDS } from '../systemRoleIds'
import type { Proyecto } from '../../types'

const ME = 'user-me'
const P1 = 'proj-1'
const P2 = 'proj-2'

// Rol de condominios que restringe la visibilidad (cualquiera salvo
// administrador_general) y el que NO restringe, para los casos mixtos.
const COND_FINANZAS = SYSTEM_ROLE_IDS.condominios.finanzas
const COND_ADMIN_GENERAL = SYSTEM_ROLE_IDS.condominios.administrador_general

const proyecto = (id: string, over: Partial<Proyecto> = {}): Proyecto =>
  ({
    id,
    nombre: id,
    company_id: 'c1',
    moneda: 'Q',
    estado: 'activo',
    max_unidades_apartamento: null,
    max_unidades_casa: null,
    max_unidades_bodega: null,
    max_unidades_local_comercial: null,
    max_unidades_oficina: null,
    max_unidades_parqueadero: null,
    max_unidades_otro: null,
    ...over,
  } as Proyecto)

describe('isProjectExempt', () => {
  it('exime a los roles de plataforma con visibilidad total', () => {
    expect(isProjectExempt('super_admin')).toBe(true)
    expect(isProjectExempt('company_owner')).toBe(true)
    expect(isProjectExempt('admin')).toBe(true)
  })

  it('no exime a roles operativos ni a un rol ausente', () => {
    expect(isProjectExempt('collector')).toBe(false)
    expect(isProjectExempt('operator')).toBe(false)
    expect(isProjectExempt(undefined)).toBe(false)
  })

  it('un rol exento con un rol de condominios restringido deja de ser exento', () => {
    expect(isProjectExempt('company_owner', [COND_FINANZAS])).toBe(false)
  })

  it('administrador_general no restringe: el rol exento sigue siéndolo', () => {
    expect(isProjectExempt('company_owner', [COND_ADMIN_GENERAL])).toBe(true)
  })
})

describe('filterProyectosByAssignment', () => {
  const proyectos = [proyecto(P1), proyecto(P2)]

  it('un rol exento ve todos los proyectos de la empresa (ignora assignments)', () => {
    const out = filterProyectosByAssignment({
      proyectos, userId: ME, role: 'company_owner', assignments: [P1],
    })
    expect(out.map((p) => p.id)).toEqual([P1, P2])
  })

  it('un rol restringido solo ve sus proyectos asignados', () => {
    const out = filterProyectosByAssignment({
      proyectos, userId: ME, role: 'collector', assignments: [P2],
    })
    expect(out.map((p) => p.id)).toEqual([P2])
  })

  it('fail-closed: assignments aún sin cargar (undefined) → ningún proyecto', () => {
    const out = filterProyectosByAssignment({
      proyectos, userId: ME, role: 'collector', assignments: undefined,
    })
    expect(out).toEqual([])
  })

  it('fail-closed: assignments en error (null) → ningún proyecto', () => {
    const out = filterProyectosByAssignment({
      proyectos, userId: ME, role: 'collector', assignments: null,
    })
    expect(out).toEqual([])
  })

  it('fail-closed: assignments vacío → ningún proyecto', () => {
    const out = filterProyectosByAssignment({
      proyectos, userId: ME, role: 'collector', assignments: [],
    })
    expect(out).toEqual([])
  })

  it('sin userId no filtra (identidad aún sin resolver)', () => {
    const out = filterProyectosByAssignment({
      proyectos, userId: undefined, role: 'collector', assignments: [],
    })
    expect(out.map((p) => p.id)).toEqual([P1, P2])
  })

  it('sin role no filtra', () => {
    const out = filterProyectosByAssignment({
      proyectos, userId: ME, role: undefined, assignments: [],
    })
    expect(out.map((p) => p.id)).toEqual([P1, P2])
  })

  it('un company_owner que además es rol restringido de condominios queda acotado', () => {
    const out = filterProyectosByAssignment({
      proyectos, userId: ME, role: 'company_owner', assignedRoleIds: [COND_FINANZAS], assignments: [P1],
    })
    expect(out.map((p) => p.id)).toEqual([P1])
  })
})

describe('deriveProyectoConfig', () => {
  it('sin proyectos → defaults (Q, sin límites)', () => {
    expect(deriveProyectoConfig([], [])).toEqual({ moneda: 'Q', maxUnidadesPorTipo: null })
  })

  it('deriva moneda y límites desde el primer proyecto accesible', () => {
    const accesibles = [
      proyecto(P1, { moneda: '$', max_unidades_apartamento: 10, max_unidades_casa: 5 }),
    ]
    expect(deriveProyectoConfig(accesibles, accesibles)).toEqual({
      moneda: '$',
      maxUnidadesPorTipo: {
        apartamento: 10,
        casa: 5,
        bodega: null,
        local_comercial: null,
        oficina: null,
        parqueadero: null,
        otro: null,
      },
    })
  })

  it('lista accesible vacía → cae al primer proyecto crudo (usuario sin acceso)', () => {
    const raw = [proyecto(P1, { moneda: 'L', max_unidades_apartamento: 3 })]
    const cfg = deriveProyectoConfig([], raw)
    expect(cfg.moneda).toBe('L')
    expect(cfg.maxUnidadesPorTipo?.apartamento).toBe(3)
  })

  it('la moneda del primer proyecto accesible tiene prioridad sobre la del crudo', () => {
    // Un rol restringido cuyo primer proyecto accesible (P2, €) difiere del
    // primero crudo de la empresa (P1, Q) ve la moneda de SU proyecto.
    const accesibles = [proyecto(P2, { moneda: '€' })]
    const raw = [proyecto(P1, { moneda: 'Q' }), proyecto(P2, { moneda: '€' })]
    expect(deriveProyectoConfig(accesibles, raw).moneda).toBe('€')
  })
})
