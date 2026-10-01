// La orden de compra NO manda la cuenta de los renglones: la resuelve y valida
// el servidor al guardar. Lo que se fija aquí: aunque la consulta de sugerencia
// siga cargando, haya fallado o ya haya traído una regla, el formulario guarda
// EXACTAMENTE lo mismo (cuenta_id null) — la misma entrada no puede dar cuentas
// distintas según la latencia de una consulta previa.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))

const m = vi.hoisted(() => ({
  crear: vi.fn(),
  sugerencia: { data: null as unknown, isLoading: true, isError: false, error: null as unknown },
}))

const vacio = { data: [], isLoading: false }
vi.mock('../../../domain/compras/queries', () => ({
  useOrdenesCompraQuery: () => vacio, useRecepcionesQuery: () => vacio, useContrasenasQuery: () => vacio,
  useActivosFijosQuery: () => vacio, useCompromisosQuery: () => vacio, useDuplicadosQuery: () => vacio,
  useOrdenCompraLineasQuery: () => vacio, useCuadreQuery: () => vacio,
}))
vi.mock('../../../domain/compras/mutations', () => ({
  useCambiarEstadoOrdenCompraMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
  useSugerenciaCuentaQuery: () => m.sugerencia,
}))
vi.mock('../ui', async (original) => {
  const real = await original<typeof import('../ui')>()
  return { ...real, usePermisosContabilidad: () => ({ puedeCrear: true, puedeEditar: true, puedeCambiarEstado: true, puedeAutorizar: true, puedeEliminar: true }) }
})

import { ComprasTab } from '../ComprasTab'

const REGLA = { cuenta_id: 'cuenta-regla', cuenta_codigo: '5201', cuenta_nombre: 'Obras', origen: 'regla_compra', regla_id: 'r', motivo: null }

async function guardarOrden(antesDeGuardar?: () => void) {
  render(<ComprasTab companyId="c1" projectId="22222222-2222-4222-8222-222222222222" monedaBase="GTQ" />)
  fireEvent.click(screen.getByText('+ Nueva orden'))
  fireEvent.change(screen.getByLabelText(/Proveedor autorizado/), { target: { value: '11111111-1111-4111-8111-111111111111' } })
  fireEvent.change(screen.getByLabelText(/Concepto/), { target: { value: 'Compra de cemento' } })
  fireEvent.change(screen.getByLabelText('Descripción del renglón 1'), { target: { value: 'Cemento 42kg' } })
  antesDeGuardar?.()
  fireEvent.click(screen.getByText('Crear borrador'))
  await waitFor(() => expect(m.crear).toHaveBeenCalled())
  return m.crear.mock.calls[0][0] as { lineas: { cuenta_id: string | null }[] }
}

beforeEach(() => { m.crear.mockResolvedValue(undefined) })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('orden de compra: la cuenta del renglón no depende de la consulta previa', () => {
  it.each([
    ['la consulta sigue CARGANDO', { data: null, isLoading: true, isError: false, error: null }],
    ['la consulta FALLÓ', { data: null, isLoading: false, isError: true, error: new Error('red caída') }],
    ['la consulta ya trajo una REGLA', { data: REGLA, isLoading: false, isError: false, error: null }],
    ['no hay regla aplicable', { data: { ...REGLA, origen: 'mapeo_evento' }, isLoading: false, isError: false, error: null }],
  ])('%s → se guarda cuenta_id null y la resuelve el servidor', async (_caso, estado) => {
    m.sugerencia = estado as typeof m.sugerencia
    const input = await guardarOrden()
    expect(input.lineas).toHaveLength(1)
    expect(input.lineas[0].cuenta_id).toBeNull()
  })

  it('con la consulta fallida el usuario ve el error y aun así puede guardar', async () => {
    m.sugerencia = { data: null, isLoading: false, isError: true, error: new Error('red caída') }
    const input = await guardarOrden(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/no se pudo consultar/)
    })
    expect(input.lineas[0].cuenta_id).toBeNull()
  })
})
