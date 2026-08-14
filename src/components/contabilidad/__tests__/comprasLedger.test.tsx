// El riel de compras vive DENTRO de una contabilidad concreta.
//
// Regresión que este test fija: en CxP, `useFacturasProveedorQuery(companyId)` y
// `useOrdenesPagoQuery(companyId)` se llamaban SIN el projectId, así que la
// pestaña listaba las facturas y órdenes de todas las contabilidades de la
// empresa dentro de cualquiera de ellas — mientras la antigüedad y la
// proyección, que sí lo pasaban, mostraban otra cosa en la misma pantalla.
// Una orden de compra o una contraseña que se cuelen de otro ledger son peores:
// terminan pagándose contra la caja equivocada.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'

const state = vi.hoisted(() => ({
  compras: [] as Array<{ hook: string; companyId?: string; projectId?: string | null }>,
  cxp: [] as Array<{ hook: string; companyId?: string; projectId?: string | null }>,
}))

// El barril de `../shared` arrastra el cliente de Supabase, que exige las env
// vars VITE_SUPABASE_* inexistentes en test.
vi.mock('../../../lib/supabase', () => ({
  supabase: {},
  warmUpSupabase: vi.fn(),
}))

const vacio = { data: [], isLoading: false }

vi.mock('../../../domain/compras/queries', () => ({
  useOrdenesCompraQuery: (companyId?: string, projectId?: string | null) => {
    state.compras.push({ hook: 'ordenes', companyId, projectId }); return vacio
  },
  useRecepcionesQuery: (companyId?: string, projectId?: string | null) => {
    state.compras.push({ hook: 'recepciones', companyId, projectId }); return vacio
  },
  useContrasenasQuery: (companyId?: string, projectId?: string | null) => {
    state.compras.push({ hook: 'contrasenas', companyId, projectId }); return vacio
  },
  useActivosFijosQuery: (companyId?: string, projectId?: string | null) => {
    state.compras.push({ hook: 'activos', companyId, projectId }); return vacio
  },
  useCompromisosQuery: (companyId?: string, projectId?: string | null) => {
    state.compras.push({ hook: 'compromisos', companyId, projectId }); return vacio
  },
  useOrdenCompraLineasQuery: () => vacio,
  useCuadreQuery: () => vacio,
}))

vi.mock('../../../domain/compras/mutations', () => ({
  useCambiarEstadoOrdenCompraMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCambiarEstadoRecepcionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCrearOrdenCompraMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCrearRecepcionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAprobarFacturaConCuadreMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCrearContrasenaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('../../../domain/cxp/queries', () => ({
  useProveedoresQuery: () => vacio,
  useFacturasProveedorQuery: (companyId?: string, filtro?: { projectId?: string | null }) => {
    state.cxp.push({ hook: 'facturas', companyId, projectId: filtro?.projectId }); return vacio
  },
  useOrdenesPagoQuery: (companyId?: string, filtro?: { projectId?: string | null }) => {
    state.cxp.push({ hook: 'ordenes', companyId, projectId: filtro?.projectId }); return vacio
  },
  useAgingQuery: (companyId?: string, projectId?: string | null) => {
    state.cxp.push({ hook: 'aging', companyId, projectId }); return vacio
  },
  useProyeccionPagosQuery: (companyId?: string, projectId?: string | null) => {
    state.cxp.push({ hook: 'proyeccion', companyId, projectId }); return vacio
  },
}))

vi.mock('../../../domain/cxp/mutations', () => ({
  useAprobarFacturaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAnularFacturaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAprobarOrdenMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMarcarOrdenPagadaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAnularOrdenMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCrearFacturaProveedorMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCrearOrdenPagoMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('../ui', async (original) => {
  const real = await original<typeof import('../ui')>()
  return {
    ...real,
    usePermisosContabilidad: () => ({
      puedeCrear: true, puedeEditar: true, puedeCambiarEstado: true,
      puedeAutorizar: true, puedeEliminar: true,
    }),
  }
})

import { ComprasTab } from '../ComprasTab'
import { CuentasPorPagarTab } from '../CuentasPorPagarTab'

beforeEach(() => {
  state.compras = []
  state.cxp = []
})
afterEach(cleanup)

describe('ComprasTab', () => {
  it('pide TODO al ledger del proyecto cuando esa es la contabilidad activa', () => {
    render(<ComprasTab companyId="c1" projectId="p1" monedaBase="GTQ" />)
    expect(state.compras.length).toBeGreaterThan(0)
    expect(state.compras.every((l) => l.companyId === 'c1' && l.projectId === 'p1')).toBe(true)
  })

  it('cubre los cinco documentos del riel, no solo el que se ve al abrir', () => {
    render(<ComprasTab companyId="c1" projectId="p1" monedaBase="GTQ" />)
    const hooks = new Set(state.compras.map((l) => l.hook))
    for (const h of ['ordenes', 'recepciones', 'contrasenas', 'activos', 'compromisos']) {
      expect(hooks.has(h)).toBe(true)
    }
  })

  // `null` es la contabilidad de la EMPRESA, no "todas": si se colara como
  // "sin filtro", la empresa vería los documentos de sus proyectos.
  it('la contabilidad de la empresa se pide con projectId null, nunca undefined', () => {
    render(<ComprasTab companyId="c1" projectId={null} monedaBase="GTQ" />)
    expect(state.compras.every((l) => l.projectId === null)).toBe(true)
    expect(state.compras.some((l) => l.projectId === undefined)).toBe(false)
  })
})

describe('CuentasPorPagarTab', () => {
  it('acota facturas y órdenes de pago al ledger activo, no solo el aging', () => {
    render(<CuentasPorPagarTab companyId="c1" projectId="p1" monedaBase="GTQ" />)
    const facturas = state.cxp.filter((l) => l.hook === 'facturas')
    const ordenes = state.cxp.filter((l) => l.hook === 'ordenes')
    expect(facturas.length).toBeGreaterThan(0)
    expect(ordenes.length).toBeGreaterThan(0)
    expect(facturas.every((l) => l.projectId === 'p1')).toBe(true)
    expect(ordenes.every((l) => l.projectId === 'p1')).toBe(true)
  })

  it('las cuatro vistas coinciden en la contabilidad que consultan', () => {
    render(<CuentasPorPagarTab companyId="c1" projectId="p1" monedaBase="GTQ" />)
    expect(state.cxp.every((l) => l.projectId === 'p1')).toBe(true)
  })

  it('en la contabilidad de la empresa ninguna vista pide "todas"', () => {
    render(<CuentasPorPagarTab companyId="c1" projectId={null} monedaBase="GTQ" />)
    expect(state.cxp.every((l) => l.projectId === null)).toBe(true)
  })
})
