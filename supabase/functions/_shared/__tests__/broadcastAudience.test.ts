// Tests de _shared/broadcastAudience.ts (infra:I22 · Track T8/T5). Como el resto
// de tests de edge fns, corre bajo vitest (no Deno) tratando el módulo como TS
// normal. Cubre la resolución PURA de la audiencia de un comunicado — en especial
// el invariante de aislamiento de tenant: pase lo que pase en target_ids, solo
// salen clientes vinculados a la empresa (companyClienteIds) y sin duplicados.

import { describe, it, expect } from 'vitest'
import {
  chunk,
  resolveBroadcastClienteIds,
  type UnidadRef,
} from '../broadcastAudience.ts'

const unidades: UnidadRef[] = [
  { id: 'u1', project_id: 'p1', cliente_id: 'c1' },
  { id: 'u2', project_id: 'p1', cliente_id: 'c2' },
  { id: 'u3', project_id: 'p2', cliente_id: 'c3' },
  { id: 'u4', project_id: 'p2', cliente_id: null }, // unidad sin cliente asignado
  { id: 'u5', project_id: 'p1', cliente_id: 'c1' }, // mismo cliente con 2 unidades
]

const companyClienteIds = ['c1', 'c2', 'c3']

describe('broadcastAudience/resolveBroadcastClienteIds', () => {
  it('todos: devuelve el padrón completo de la empresa, deduplicado', () => {
    expect(resolveBroadcastClienteIds({
      targetType: 'todos',
      targetIds: [],
      companyClienteIds: ['c1', 'c2', 'c2', 'c3'],
      unidades: [],
    })).toEqual(['c1', 'c2', 'c3'])
  })

  it('clientes: SIEMPRE interseca con la empresa — ids ajenos/inventados se descartan', () => {
    expect(resolveBroadcastClienteIds({
      targetType: 'clientes',
      targetIds: ['c2', 'cliente-de-otro-tenant', 'c2', 'c-inexistente'],
      companyClienteIds,
      unidades: [],
    })).toEqual(['c2'])
  })

  it('proyecto: clientes de las unidades de los proyectos elegidos (ignora unidades sin cliente)', () => {
    expect(resolveBroadcastClienteIds({
      targetType: 'proyecto',
      targetIds: ['p2'],
      companyClienteIds,
      unidades,
    })).toEqual(['c3'])
  })

  it('proyecto: un cliente con varias unidades sale una sola vez', () => {
    expect(resolveBroadcastClienteIds({
      targetType: 'proyecto',
      targetIds: ['p1'],
      companyClienteIds,
      unidades,
    })).toEqual(['c1', 'c2'])
  })

  it('unidades: resuelve el cliente de cada unidad elegida', () => {
    expect(resolveBroadcastClienteIds({
      targetType: 'unidades',
      targetIds: ['u2', 'u4'], // u4 no tiene cliente → no aporta
      companyClienteIds,
      unidades,
    })).toEqual(['c2'])
  })

  it('proyecto/unidades también intersecan con la empresa (unidad con cliente desvinculado)', () => {
    expect(resolveBroadcastClienteIds({
      targetType: 'unidades',
      targetIds: ['u1'],
      companyClienteIds: ['c2', 'c3'], // c1 ya no está vinculado a la empresa
      unidades,
    })).toEqual([])
  })

  it('target type desconocido resuelve a lista vacía (rama default)', () => {
    expect(resolveBroadcastClienteIds({
      targetType: 'empresa' as never,
      targetIds: ['c1'],
      companyClienteIds,
      unidades,
    })).toEqual([])
  })

  it('sin selección no hay destinatarios (el handler responde 400)', () => {
    expect(resolveBroadcastClienteIds({
      targetType: 'clientes',
      targetIds: [],
      companyClienteIds,
      unidades: [],
    })).toEqual([])
  })
})

describe('broadcastAudience/chunk', () => {
  it('parte en lotes exactos y deja el residuo al final', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]])
  })

  it('lista vacía → sin lotes; lote mayor que la lista → un solo lote', () => {
    expect(chunk([], 1000)).toEqual([])
    expect(chunk(['a'], 1000)).toEqual([['a']])
  })

  it('no pierde ni duplica elementos (invariante del batch INSERT)', () => {
    const ids = Array.from({ length: 2501 }, (_, i) => `c${i}`)
    const parts = chunk(ids, 1000)
    expect(parts.map((p) => p.length)).toEqual([1000, 1000, 501])
    expect(parts.flat()).toEqual(ids)
  })
})
