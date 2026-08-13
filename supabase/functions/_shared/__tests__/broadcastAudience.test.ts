// Tests de la resolución PURA de audiencia de un comunicado (_shared/
// broadcastAudience.ts). Como el resto de tests de edge fns, corre bajo vitest
// tratando el módulo como TS normal. Cubre la resolución por tipo de audiencia y
// el recorte por proyecto del emisor (la parte que impide difundir a clientes de
// proyectos no asignados mandando `target_ids` arbitrarios desde el navegador).

import { describe, it, expect } from 'vitest'
import {
  RESTRICTED_COND_ROLE_IDS,
  chunk,
  isProjectExemptSender,
  resolveBroadcastClienteIds,
  restrictClienteIdsToProjects,
  type UnidadRef,
} from '../broadcastAudience.ts'

const P_MINE = 'proj-mine'
const P_OTHER = 'proj-other'

const unidad = (id: string, project_id: string, cliente_id: string | null): UnidadRef =>
  ({ id, project_id, cliente_id })

const unidades: UnidadRef[] = [
  unidad('u1', P_MINE, 'cl1'),
  unidad('u2', P_OTHER, 'cl2'),
  unidad('u3', P_MINE, null),
]
const companyClienteIds = ['cl1', 'cl2', 'cl3']

describe('resolveBroadcastClienteIds', () => {
  it("'todos' abanica a todo el padrón de la empresa", () => {
    const ids = resolveBroadcastClienteIds({ targetType: 'todos', targetIds: [], companyClienteIds, unidades })
    expect(ids.sort()).toEqual(['cl1', 'cl2', 'cl3'])
  })

  it("'proyecto' resuelve los clientes vía las unidades del proyecto", () => {
    const ids = resolveBroadcastClienteIds({ targetType: 'proyecto', targetIds: [P_MINE], companyClienteIds, unidades })
    expect(ids).toEqual(['cl1'])
  })

  it("'unidades' resuelve los clientes de las unidades elegidas", () => {
    const ids = resolveBroadcastClienteIds({ targetType: 'unidades', targetIds: ['u2'], companyClienteIds, unidades })
    expect(ids).toEqual(['cl2'])
  })

  it('descarta ids que no pertenecen al padrón de la empresa', () => {
    const ids = resolveBroadcastClienteIds({
      targetType: 'clientes',
      targetIds: ['cl1', 'cl-de-otra-empresa'],
      companyClienteIds,
      unidades,
    })
    expect(ids).toEqual(['cl1'])
  })

  it('deduplica destinatarios repetidos', () => {
    const ids = resolveBroadcastClienteIds({
      targetType: 'clientes',
      targetIds: ['cl1', 'cl1'],
      companyClienteIds,
      unidades,
    })
    expect(ids).toEqual(['cl1'])
  })
})

describe('isProjectExemptSender', () => {
  it('exime a super_admin / company_owner / admin sin roles de condominios', () => {
    for (const role of ['super_admin', 'superadmin', 'company_owner', 'admin']) {
      expect(isProjectExemptSender(role, [])).toBe(true)
    }
  })

  it('NO exime a un owner/admin que además carga un rol de condominios acotado', () => {
    for (const roleId of RESTRICTED_COND_ROLE_IDS) {
      expect(isProjectExemptSender('company_owner', [roleId])).toBe(false)
    }
  })

  it('sigue eximiendo al administrador general de condominios', () => {
    expect(isProjectExemptSender('company_owner', ['00000000-0000-0000-0000-000000000001'])).toBe(true)
  })

  it('no exime a roles fuera del whitelist', () => {
    expect(isProjectExemptSender('operator', [])).toBe(false)
    expect(isProjectExemptSender('', [])).toBe(false)
  })
})

describe('restrictClienteIdsToProjects', () => {
  it('deja fuera a los clientes de proyectos no asignados', () => {
    const ids = restrictClienteIdsToProjects({
      clienteIds: ['cl1', 'cl2'],
      allowedProjectIds: [P_MINE],
      unidades,
    })
    expect(ids).toEqual(['cl1'])
  })

  it('conserva a los clientes que aún no se mapean a ningún proyecto', () => {
    const ids = restrictClienteIdsToProjects({
      clienteIds: ['cl3'],
      allowedProjectIds: [P_MINE],
      unidades,
    })
    expect(ids).toEqual(['cl3'])
  })

  it('sin proyectos asignados solo pasan los clientes sin mapear', () => {
    const ids = restrictClienteIdsToProjects({
      clienteIds: ['cl1', 'cl2', 'cl3'],
      allowedProjectIds: [],
      unidades,
    })
    expect(ids).toEqual(['cl3'])
  })

  it('conserva a un cliente presente en varios proyectos si uno es accesible', () => {
    const ids = restrictClienteIdsToProjects({
      clienteIds: ['cl1'],
      allowedProjectIds: [P_MINE],
      unidades: [...unidades, unidad('u4', P_OTHER, 'cl1')],
    })
    expect(ids).toEqual(['cl1'])
  })
})

describe('chunk', () => {
  it('parte la lista en lotes del tamaño pedido', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('devuelve [] para una lista vacía', () => {
    expect(chunk([], 10)).toEqual([])
  })
})
