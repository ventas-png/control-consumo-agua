// Órdenes de compra amparadas en un contrato (Contabilidad).
//
// Se fija lo que la pantalla OFRECE: elegir el contrato al crear la orden y, al aprobar o emitir, el camino de la
// excepción cuando el servidor rechaza por contrato no vigente. Las reglas (misma moneda, proveedor, proyecto,
// vigencia, monto, quién autoriza) las prueba supabase/tests/compras_bloque_b/assert_contratos_compras.sql.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

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

const NO_VIGENTE = new Error('COMPRAS_CONTRATO_NO_VIGENTE: no se puede aprobar la orden al amparo de su contrato (rebasa el monto máximo vigente de 1000.00)')

const orden = (estado: string, contrato: string | null = 'k1') => ({
  id: 'o1', numero: 'OC-000001', proveedor_id: '11111111-1111-4111-8111-111111111111', proveedor_nombre: 'Ferretería', concepto: 'Material',
  moneda: 'GTQ', total: 600, estado, contrato_id: contrato, proveedores: { nombre: 'Ferretería' },
})

beforeEach(() => {
  m.permisos = { puedeCrear: true, puedeEditar: true, puedeCambiarEstado: true, puedeAutorizar: true, puedeEliminar: true }
  m.ordenes = []
  m.crear.mockResolvedValue(undefined)
  m.cambiar.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Nueva orden: contrato opcional', () => {
  async function crear(elegirContrato: boolean) {
    render(<ComprasTab companyId="c1" projectId="22222222-2222-4222-8222-222222222222" monedaBase="GTQ" />)
    fireEvent.click(screen.getByText('+ Nueva orden'))
    fireEvent.change(screen.getByLabelText(/Proveedor autorizado/), { target: { value: '11111111-1111-4111-8111-111111111111' } })
    if (elegirContrato) fireEvent.change(screen.getByLabelText(/Contrato \(opcional\)/), { target: { value: '33333333-3333-4333-8333-333333333333' } })
    fireEvent.change(screen.getByLabelText(/Concepto/), { target: { value: 'Compra de cemento' } })
    fireEvent.change(screen.getByLabelText('Descripción del renglón 1'), { target: { value: 'Cemento 42kg' } })
    fireEvent.click(screen.getByText('Crear borrador'))
    await waitFor(() => expect(m.crear).toHaveBeenCalled())
    return m.crear.mock.calls[0][0] as { contrato_id: string | null }
  }

  it('con contrato elegido viaja su id; el servidor valida proveedor, proyecto, moneda y vigencia', async () => {
    expect((await crear(true)).contrato_id).toBe('33333333-3333-4333-8333-333333333333')
  })

  it('sin elegir contrato se compra como siempre (contrato_id null)', async () => {
    expect((await crear(false)).contrato_id).toBeNull()
  })

  it('cambiar de proveedor suelta el contrato elegido (era de otro proveedor)', () => {
    render(<ComprasTab companyId="c1" projectId="22222222-2222-4222-8222-222222222222" monedaBase="GTQ" />)
    fireEvent.click(screen.getByText('+ Nueva orden'))
    fireEvent.change(screen.getByLabelText(/Proveedor autorizado/), { target: { value: '11111111-1111-4111-8111-111111111111' } })
    fireEvent.change(screen.getByLabelText(/Contrato \(opcional\)/), { target: { value: '33333333-3333-4333-8333-333333333333' } })
    expect((screen.getByLabelText(/Contrato \(opcional\)/) as HTMLSelectElement).value).toBe('33333333-3333-4333-8333-333333333333')
    fireEvent.change(screen.getByLabelText(/Proveedor autorizado/), { target: { value: '' } })
    expect((screen.getByLabelText(/Contrato \(opcional\)/) as HTMLSelectElement).value).toBe('')
  })

  it('en la contabilidad de la EMPRESA (sin proyecto) no hay contratos: se explica', () => {
    render(<ComprasTab companyId="c1" projectId={null} monedaBase="GTQ" />)
    fireEvent.click(screen.getByText('+ Nueva orden'))
    expect(screen.getByTestId('contrato-sin-proyecto')).toBeTruthy()
  })
})

describe('Aprobar y emitir con contrato no vigente', () => {
  it('aprobar: el servidor rechaza, se pide el motivo, se autoriza la excepción y se reintenta', async () => {
    m.ordenes = [orden('borrador')]
    m.cambiar.mockRejectedValueOnce(NO_VIGENTE).mockResolvedValueOnce(undefined)
    m.prompt.mockResolvedValueOnce({ motivo: '  Contrato en renovación; el servicio no puede parar  ' })
    render(<ComprasTab companyId="c1" projectId="22222222-2222-4222-8222-222222222222" monedaBase="GTQ" />)
    fireEvent.click(screen.getByText('Aprobar'))
    await waitFor(() => expect(m.excepcion).toHaveBeenCalledWith({
      ordenId: 'o1', etapa: 'aprobar', motivo: 'Contrato en renovación; el servicio no puede parar',
    }))
    expect(m.cambiar).toHaveBeenCalledTimes(2)
    expect(m.prompt.mock.calls[0][0].description).toMatch(/rebasa el monto máximo/)
    await waitFor(() => expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' })))
  })

  it('emitir pide SU propia excepción (etapa «emitir»)', async () => {
    m.ordenes = [orden('aprobada')]
    m.cambiar.mockRejectedValueOnce(NO_VIGENTE).mockResolvedValueOnce(undefined)
    m.prompt.mockResolvedValueOnce({ motivo: 'Se emite hoy; la renovación se firma esta semana' })
    render(<ComprasTab companyId="c1" projectId="22222222-2222-4222-8222-222222222222" monedaBase="GTQ" />)
    fireEvent.click(screen.getByText('Emitir'))
    await waitFor(() => expect(m.excepcion).toHaveBeenCalledWith(expect.objectContaining({ etapa: 'emitir' })))
  })

  it('sin el permiso de cambio de estado: no se ofrece la excepción y se muestra el rechazo del servidor', async () => {
    m.permisos = { ...m.permisos, puedeCambiarEstado: false }
    m.ordenes = [orden('borrador')]
    m.cambiar.mockRejectedValue(NO_VIGENTE)
    render(<ComprasTab companyId="c1" projectId="22222222-2222-4222-8222-222222222222" monedaBase="GTQ" />)
    fireEvent.click(screen.getByText('Aprobar'))
    await waitFor(() => expect(m.notify).toHaveBeenCalled())
    expect(m.notify.mock.calls[0][0].text).toMatch(/COMPRAS_CONTRATO_NO_VIGENTE/)
    expect(m.prompt).not.toHaveBeenCalled()
    expect(m.excepcion).not.toHaveBeenCalled()
  })

  it('sin escribir el motivo no se autoriza nada y la orden no cambia', async () => {
    m.ordenes = [orden('borrador')]
    m.cambiar.mockRejectedValue(NO_VIGENTE)
    m.prompt.mockResolvedValueOnce(null)
    render(<ComprasTab companyId="c1" projectId="22222222-2222-4222-8222-222222222222" monedaBase="GTQ" />)
    fireEvent.click(screen.getByText('Aprobar'))
    await waitFor(() => expect(m.notify).toHaveBeenCalled())
    expect(m.excepcion).not.toHaveBeenCalled()
    expect(m.cambiar).toHaveBeenCalledTimes(1)
  })

  it('una orden SIN contrato no abre la excepción: otros rechazos (p. ej. proveedor suspendido) se muestran tal cual', async () => {
    m.ordenes = [orden('borrador', null)]
    m.cambiar.mockRejectedValue(new Error('COMPRAS_PROVEEDOR_NO_AUTORIZADO: "Ferretería" está en estado "suspendido"'))
    render(<ComprasTab companyId="c1" projectId="22222222-2222-4222-8222-222222222222" monedaBase="GTQ" />)
    fireEvent.click(screen.getByText('Aprobar'))
    await waitFor(() => expect(m.notify).toHaveBeenCalled())
    expect(m.prompt).not.toHaveBeenCalled()
  })

  it('con contrato y proveedor suspendido el rechazo NO es de contrato: no se ofrece excepción', async () => {
    m.ordenes = [orden('borrador')]
    m.cambiar.mockRejectedValue(new Error('COMPRAS_PROVEEDOR_NO_AUTORIZADO: "Ferretería" está en estado "suspendido"'))
    render(<ComprasTab companyId="c1" projectId="22222222-2222-4222-8222-222222222222" monedaBase="GTQ" />)
    fireEvent.click(screen.getByText('Aprobar'))
    await waitFor(() => expect(m.notify).toHaveBeenCalled())
    expect(m.excepcion).not.toHaveBeenCalled()
  })
})
