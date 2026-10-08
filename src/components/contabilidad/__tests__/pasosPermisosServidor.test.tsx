// Botones de PASO de compras (Contabilidad) alineados con lo que el servidor exige de verdad.
//
// El servidor pide, para aprobar: «Autorizar / Denegar» Y «Editar» (la política de UPDATE pide editar y el trigger de
// permiso por acción pide la acción); para emitir, cancelar, registrar o anular: «Cambiar estado» Y «Editar». Con solo
// la acción el UPDATE no afecta ninguna fila y la pantalla decía «Listo». Aquí se fija que el botón no se ofrece.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))

const m = vi.hoisted(() => ({
  crear: vi.fn(),
  cambiar: vi.fn(),
  excepcion: vi.fn(),
  prompt: vi.fn(),
  notify: vi.fn(),
  permisos: { puedeCrear: true, puedeEditar: true, puedeCambiarEstado: true, puedeAutorizar: true, puedeEliminar: true },
  ordenes: [] as unknown[],
}))

vi.mock('../../../domain/proveedores/contratosCompras', async (orig) => ({
  ...(await orig<typeof import('../../../domain/proveedores/contratosCompras')>()),
  useContratosParaOrdenQuery: () => ({
    data: [{
      id: '33333333-3333-4333-8333-333333333333', company_id: 'c1', project_id: 'p', proveedor_id: '11111111-1111-4111-8111-111111111111', referencia: 'CT-01',
      proveedor_nombre: 'Ferretería', servicio: 'otro', fecha_inicio: '2026-01-01', fecha_fin: null, estado: 'activo',
      created_at: '2026-01-01', moneda: 'GTQ', monto_maximo: 1000,
    }],
    isLoading: false,
  }),
  useExcepcionContratoMutation: () => ({ mutateAsync: m.excepcion }),
}))
const vacio = { data: [], isLoading: false }
vi.mock('../../../domain/compras/queries', () => ({
  useOrdenesCompraQuery: () => ({ data: m.ordenes, isLoading: false }),
  useRecepcionesQuery: () => vacio, useContrasenasQuery: () => vacio,
  useActivosFijosQuery: () => vacio, useCompromisosQuery: () => vacio, useDuplicadosQuery: () => vacio,
  useOrdenCompraLineasQuery: () => vacio, useCuadreQuery: () => vacio, useInsumosAlmacenQuery: () => vacio,
}))
vi.mock('../../../domain/compras/mutations', () => ({
  useCambiarEstadoOrdenCompraMutation: () => ({ mutateAsync: m.cambiar, isPending: false }),
  useCambiarEstadoRecepcionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCrearOrdenCompraMutation: () => ({ mutateAsync: m.crear, isPending: false }),
  useCrearRecepcionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAprobarFacturaConCuadreMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCrearContrasenaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEnlazarGastoAFacturaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDescartarDuplicadoMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../../../domain/cxp/queries', () => ({
  useProveedoresQuery: () => ({
    data: [{ id: '11111111-1111-4111-8111-111111111111', nombre: 'Ferretería', estado: 'autorizado', activo: true, autorizacion_vence: null }],
    isLoading: false,
  }),
  useFacturasProveedorQuery: () => vacio, useOrdenesPagoQuery: () => vacio,
  useAgingQuery: () => vacio, useProyeccionPagosQuery: () => vacio,
}))
vi.mock('../../../domain/cxp/mutations', () => ({}))
vi.mock('../../../domain/proveedores/queries', () => ({
  useSugerenciaCuentaQuery: () => ({ data: null, isLoading: false, isError: false, error: null }),
}))
vi.mock('../../shared/PromptDialog', () => ({ openPromptDialog: m.prompt }))
vi.mock('../../shared/Dialog', () => ({ confirm: vi.fn(), notify: m.notify }))
vi.mock('../ui', async (original) => {
  const real = await original<typeof import('../ui')>()
  return { ...real, usePermisosContabilidad: () => m.permisos }
})

import { ComprasTab } from '../ComprasTab'

const orden = (estado: string) => ({
  id: 'o1', numero: 'OC-000001', proveedor_id: '11111111-1111-4111-8111-111111111111', proveedor_nombre: 'Ferretería', concepto: 'Material',
  moneda: 'GTQ', total: 600, estado, contrato_id: null, proveedores: { nombre: 'Ferretería' },
})
const base = { puedeCrear: true, puedeEditar: true, puedeCambiarEstado: true, puedeAutorizar: true, puedeEliminar: true }
const montar = () => render(<ComprasTab companyId="c1" projectId="22222222-2222-4222-8222-222222222222" monedaBase="GTQ" />)

beforeEach(() => { m.permisos = { ...base }; m.ordenes = [] })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('ComprasTab · cada paso exige la acción Y «Editar»', () => {
  it('con «Autorizar» pero SIN «Editar» no se ofrece aprobar una orden en borrador', () => {
    m.permisos = { ...base, puedeEditar: false }
    m.ordenes = [orden('borrador')]
    montar()
    expect(screen.queryByText('Aprobar')).toBeNull()
  })

  it('con «Autorizar» y «Editar» sí se ofrece aprobar', () => {
    m.ordenes = [orden('borrador')]
    montar()
    expect(screen.getByText('Aprobar')).toBeTruthy()
  })

  it('con «Cambiar estado» pero SIN «Editar» no se ofrece emitir ni cancelar una orden aprobada', () => {
    m.permisos = { ...base, puedeEditar: false }
    m.ordenes = [orden('aprobada')]
    montar()
    expect(screen.queryByText('Emitir')).toBeNull()
    expect(screen.queryByText(/Cancelar/)).toBeNull()
  })

  it('con «Cambiar estado» y «Editar» sí se ofrece emitir', () => {
    m.ordenes = [orden('aprobada')]
    montar()
    expect(screen.getByText('Emitir')).toBeTruthy()
  })

  it('«Editar» solo, sin ninguna acción, tampoco ofrece pasos', () => {
    m.permisos = { ...base, puedeCambiarEstado: false, puedeAutorizar: false }
    m.ordenes = [orden('borrador')]
    montar()
    expect(screen.queryByText('Aprobar')).toBeNull()
  })
})
