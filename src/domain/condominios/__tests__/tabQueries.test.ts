// T7/PR3 (sección A) — Contrato de las lecturas bespoke de tabs de condominios.
// Mock encadenable por-tabla: from(table) devuelve un builder thenable que
// resuelve al resultado configurado para esa tabla (permite afirmar las 4
// queries paralelas de fetchProyectoResumen).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state: { byTable: Record<string, unknown>; fallback: unknown } = {
    byTable: {}, fallback: { data: null, count: null, error: null },
  }
  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'order', 'limit', 'gte', 'lte', 'update']) b[m] = () => b
    b.then = (resolve: (v: unknown) => void) => resolve(state.byTable[table] ?? state.fallback)
    return b
  }
  return { state, from: (t: string) => makeBuilder(t) }
})

vi.mock('../../../lib/supabase', () => ({ supabase: { from: h.from } }))

import {
  fetchDirectorioResidentes,
  fetchProyectoResumen,
  fetchMensajesPortal,
  activarPortalUnidad,
  fetchFondoReservaAprobado,
  fetchFondoReservaMovimientos,
  fetchPresupuestosAnio,
  fetchGastosAnioMontos,
  fetchEjecucionesMantenimiento,
} from '../tabQueries'

beforeEach(() => { h.state.byTable = {}; h.state.fallback = { data: null, count: null, error: null } })

describe('fetchDirectorioResidentes', () => {
  it('devuelve filas de unidades+clientes', async () => {
    h.state.byTable.unidades = { data: [{ nombre: 'A-1', clientes: { nombre: 'Ana' } }], error: null }
    expect(await fetchDirectorioResidentes('p1')).toEqual([{ nombre: 'A-1', clientes: { nombre: 'Ana' } }])
  })
  it('sin data → []', async () => {
    expect(await fetchDirectorioResidentes('p1')).toEqual([])
  })
})

describe('fetchProyectoResumen', () => {
  it('combina las 4 queries (filas + counts)', async () => {
    h.state.byTable.cuotas_condominio = { data: [{ estado: 'pagado', monto: 100, fecha_vencimiento: null }], error: null }
    h.state.byTable.tickets_mantenimiento = { data: [{ estado: 'abierto' }], error: null }
    h.state.byTable.unidades = { data: null, count: 12, error: null }
    h.state.byTable.visitantes = { data: null, count: 3, error: null }
    const r = await fetchProyectoResumen('p1', 'co1', '2026-06-06')
    expect(r).toEqual({
      cuotas: [{ estado: 'pagado', monto: 100, fecha_vencimiento: null }],
      tickets: [{ estado: 'abierto' }],
      unidadesCount: 12,
      visitantesCount: 3,
    })
  })
  it('degrada filas a [] y counts a 0', async () => {
    const r = await fetchProyectoResumen('p1', 'co1', '2026-06-06')
    expect(r).toEqual({ cuotas: [], tickets: [], unidadesCount: 0, visitantesCount: 0 })
  })
})

describe('PortalResidenteTab helpers', () => {
  it('fetchMensajesPortal devuelve filas', async () => {
    h.state.byTable.mensajes_portal = { data: [{ id: 'm1', estado: 'nuevo' }], error: null }
    expect(await fetchMensajesPortal('u1')).toEqual([{ id: 'm1', estado: 'nuevo' }])
  })
  it('activarPortalUnidad éxito → { error: null }', async () => {
    h.state.byTable.unidades = { error: null }
    expect(await activarPortalUnidad('u1', 'tok')).toEqual({ error: null })
  })
  it('activarPortalUnidad error → mensaje legible', async () => {
    h.state.byTable.unidades = { error: { message: 'rls' } }
    expect(await activarPortalUnidad('u1', 'tok')).toEqual({ error: 'rls' })
  })
})

describe('PortalTransparenciaTab reads', () => {
  it('fetchFondoReservaAprobado degrada a []', async () => {
    expect(await fetchFondoReservaAprobado('p1')).toEqual([])
  })
  it('fetchFondoReservaMovimientos devuelve filas', async () => {
    h.state.byTable.fondo_reserva_movimientos = { data: [{ tipo: 'aportacion', monto: 50 }], error: null }
    expect(await fetchFondoReservaMovimientos('p1')).toEqual([{ tipo: 'aportacion', monto: 50 }])
  })
  it('fetchPresupuestosAnio devuelve filas', async () => {
    h.state.byTable.presupuestos_condominio = { data: [{ categoria: 'agua', monto_presupuestado: 1000 }], error: null }
    expect(await fetchPresupuestosAnio('p1', 2026)).toEqual([{ categoria: 'agua', monto_presupuestado: 1000 }])
  })
  it('fetchGastosAnioMontos degrada a []', async () => {
    expect(await fetchGastosAnioMontos('p1', 2026)).toEqual([])
  })
})

describe('fetchEjecucionesMantenimiento', () => {
  it('devuelve filas del plan', async () => {
    h.state.byTable.ejecuciones_mantenimiento = { data: [{ id: 'e1', fecha: '2026-01-01' }], error: null }
    expect(await fetchEjecucionesMantenimiento('plan1')).toEqual([{ id: 'e1', fecha: '2026-01-01' }])
  })
  it('sin data → []', async () => {
    expect(await fetchEjecucionesMantenimiento('plan1')).toEqual([])
  })
})
