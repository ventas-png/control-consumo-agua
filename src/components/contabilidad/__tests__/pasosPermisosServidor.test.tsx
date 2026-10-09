// Botones de PASO de compras (Contabilidad › Compras) alineados con lo que el servidor exige de verdad.
//
// El servidor pide, para cada decisión, SU llave Y «Editar» de Contabilidad (la política de UPDATE de esas tablas pide
// editar y el trigger de permiso por acción pide la llave):
//   · aprobar una orden de compra y devolverla a borrador → «Autorizar / Denegar — Órdenes compra»;
//   · registrar una recepción                              → «Compras y pagos — Registrar una recepción»;
//   · emitir, cancelar (orden) y anular (recepción)       → «Cambiar estado» de Contabilidad.
// Con solo la llave, o con solo «Editar», el UPDATE no afecta ninguna fila y la pantalla decía «Listo». Los permisos
// GENÉRICOS «Autorizar / Denegar» y «Cambiar estado» ya no conceden aprobar ni registrar. Aquí se fija qué se ofrece,
// con las llaves RBAC reales de la sesión (no con booleanos simulados).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { LLAVES_ACCION_COMPRAS } from '../../../lib/platformPermissions'
import { GENERICOS_APROBAR, VER_Y_EDITAR, montarConSesion } from '../../../test/sesionPermisos'

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))

const m = vi.hoisted(() => ({
  cambiarOrden: vi.fn(),
  cambiarRecepcion: vi.fn(),
  confirm: vi.fn(),
  prompt: vi.fn(),
  notify: vi.fn(),
  ordenes: [] as unknown[],
  recepciones: [] as unknown[],
}))

const vacio = { data: [], isLoading: false }
vi.mock('../../../domain/compras/queries', () => ({
  useOrdenesCompraQuery: () => ({ data: m.ordenes, isLoading: false }),
  useRecepcionesQuery: () => ({ data: m.recepciones, isLoading: false }),
  useContrasenasQuery: () => vacio, useActivosFijosQuery: () => vacio, useCompromisosQuery: () => vacio,
  useDuplicadosQuery: () => vacio, useOrdenCompraLineasQuery: () => vacio, useCuadreQuery: () => vacio,
  useInsumosAlmacenQuery: () => vacio,
}))
vi.mock('../../../domain/compras/mutations', () => ({
  useCambiarEstadoOrdenCompraMutation: () => ({ mutateAsync: m.cambiarOrden, isPending: false }),
  useCambiarEstadoRecepcionMutation: () => ({ mutateAsync: m.cambiarRecepcion, isPending: false }),
  useCrearOrdenCompraMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCrearRecepcionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAprobarFacturaConCuadreMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCrearContrasenaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEnlazarGastoAFacturaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDescartarDuplicadoMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../../../domain/proveedores/contratosCompras', async (orig) => ({
  ...(await orig<typeof import('../../../domain/proveedores/contratosCompras')>()),
  useContratosParaOrdenQuery: () => ({ data: [], isLoading: false }),
  useExcepcionContratoMutation: () => ({ mutateAsync: vi.fn() }),
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
  useResponsablesQuery: () => vacio,
}))
vi.mock('../../shared/PromptDialog', () => ({ openPromptDialog: m.prompt }))
vi.mock('../../shared/Dialog', () => ({ confirm: m.confirm, notify: m.notify }))

import { ComprasTab } from '../ComprasTab'

const K = LLAVES_ACCION_COMPRAS
const TODAS = Object.values(K)
const todasMenos = (llave: string) => TODAS.filter((k) => k !== llave)

const orden = (estado: string) => ({
  id: 'o1', numero: 'OC-000001', proveedor_id: '11111111-1111-4111-8111-111111111111', proveedor_nombre: 'Ferretería', concepto: 'Material',
  moneda: 'GTQ', total: 600, estado, contrato_id: null, proveedores: { nombre: 'Ferretería' },
})
const recepcion = (estado: string) => ({
  id: 'r1', numero: 'REC-000001', fecha: '2026-10-01', documento_referencia: 'REM-1', estado, tipo: 'bienes',
  ordenes_compra: { numero: 'OC-000001', concepto: 'Material' },
})

const montar = (permisos: readonly string[], role = 'operator') =>
  montarConSesion(<ComprasTab companyId="c1" projectId="22222222-2222-4222-8222-222222222222" monedaBase="GTQ" />, { permisos, role })
const verRecepciones = () => fireEvent.click(screen.getByRole('radio', { name: /Recepciones/ }))

beforeEach(() => {
  m.ordenes = []; m.recepciones = []
  m.cambiarOrden.mockResolvedValue(undefined); m.cambiarRecepcion.mockResolvedValue(undefined)
  m.confirm.mockResolvedValue({ isConfirmed: true })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('ComprasTab · órdenes de compra: cada paso exige SU llave Y «Editar»', () => {
  it('con la llave de la orden pero SIN «Editar» no se ofrece aprobar una orden en borrador', () => {
    m.ordenes = [orden('borrador')]
    montar(['platform.contabilidad.view', K.aprobarOrdenCompra])
    expect(screen.queryByText('Aprobar')).toBeNull()
  })

  it('con la llave de la orden y «Editar» sí se ofrece aprobar, y el clic aprueba esa orden', async () => {
    m.ordenes = [orden('borrador')]
    montar([...VER_Y_EDITAR, K.aprobarOrdenCompra])
    fireEvent.click(screen.getByText('Aprobar'))
    await waitFor(() => expect(m.cambiarOrden).toHaveBeenCalledWith({ id: 'o1', estado: 'aprobada' }))
  })

  it('con «Cambiar estado» pero SIN «Editar» no se ofrece emitir ni cancelar una orden aprobada', () => {
    m.ordenes = [orden('aprobada')]
    montar(['platform.contabilidad.view', 'platform.contabilidad.change_status'])
    expect(screen.queryByText('Emitir')).toBeNull()
    expect(screen.queryByText(/Cancelar/)).toBeNull()
  })

  it('con «Cambiar estado» y «Editar» sí se ofrece emitir y cancelar', () => {
    m.ordenes = [orden('aprobada')]
    montar([...VER_Y_EDITAR, 'platform.contabilidad.change_status'])
    expect(screen.getByText('Emitir')).toBeTruthy()
    expect(screen.getByText('Cancelar')).toBeTruthy()
  })

  it('«Editar» solo, sin ninguna acción, tampoco ofrece pasos', () => {
    m.ordenes = [orden('borrador')]
    montar([...VER_Y_EDITAR])
    expect(screen.queryByText('Aprobar')).toBeNull()
  })

  it('«Autorizar / Denegar» y «Cambiar estado» genéricos + las otras cinco llaves, SIN la de la orden: no se ofrece aprobar', () => {
    m.ordenes = [orden('borrador')]
    montar([...VER_Y_EDITAR, ...GENERICOS_APROBAR, ...todasMenos(K.aprobarOrdenCompra)])
    expect(screen.queryByText('Aprobar')).toBeNull()
  })

  it('lo mismo para devolver a borrador una orden aprobada; emitir y cancelar siguen disponibles con «Cambiar estado»', () => {
    m.ordenes = [orden('aprobada')]
    montar([...VER_Y_EDITAR, ...GENERICOS_APROBAR, ...todasMenos(K.aprobarOrdenCompra)])
    expect(screen.queryByText('Devolver a borrador')).toBeNull()
    expect(screen.getByText('Emitir')).toBeTruthy()
    expect(screen.getByText('Cancelar')).toBeTruthy()
  })

  it('la llave de la orden SOLA ofrece aprobar y devolver, pero no emitir ni cancelar', () => {
    m.ordenes = [orden('aprobada')]
    montar([...VER_Y_EDITAR, K.aprobarOrdenCompra])
    expect(screen.getByText('Devolver a borrador')).toBeTruthy()
    expect(screen.queryByText('Emitir')).toBeNull()
    expect(screen.queryByText('Cancelar')).toBeNull()
  })

  it.each(['admin', 'company_owner', 'super_admin', 'superadmin'])('%s (exento) ve aprobar, devolver, emitir y cancelar sin llaves propias', (rol) => {
    m.ordenes = [orden('borrador')]
    const borrador = montar([], rol)
    expect(screen.getByText('Aprobar')).toBeTruthy()
    expect(screen.getByText('Cancelar')).toBeTruthy()
    borrador.unmount()

    m.ordenes = [orden('aprobada')]
    montar([], rol)
    expect(screen.getByText('Devolver a borrador')).toBeTruthy()
    expect(screen.getByText('Emitir')).toBeTruthy()
    expect(screen.getByText('Cancelar')).toBeTruthy()
  })
})

describe('ComprasTab · recepciones: registrar tiene su llave; anular sigue con «Cambiar estado»', () => {
  it('con la llave de registrar y «Editar» se ofrece Registrar, y el clic (tras confirmar) registra esa recepción', async () => {
    m.recepciones = [recepcion('borrador')]
    montar([...VER_Y_EDITAR, K.registrarRecepcion])
    verRecepciones()
    fireEvent.click(screen.getByText('Registrar'))
    await waitFor(() => expect(m.cambiarRecepcion).toHaveBeenCalledWith({ id: 'r1', estado: 'registrada' }))
  })

  it('«Cancelar» en el diálogo de confirmación NO registra la recepción (mueve existencias y contabiliza)', async () => {
    m.recepciones = [recepcion('borrador')]
    m.confirm.mockResolvedValue({ isConfirmed: false })
    montar([...VER_Y_EDITAR, K.registrarRecepcion])
    verRecepciones()
    fireEvent.click(screen.getByText('Registrar'))
    await waitFor(() => expect(m.confirm).toHaveBeenCalled())
    // el clic ya resolvió el diálogo; un tick más para asegurar que nada se encadenó
    await Promise.resolve()
    expect(m.cambiarRecepcion).not.toHaveBeenCalled()
  })

  it('con la llave de registrar pero SIN «Editar» no se ofrece Registrar', () => {
    m.recepciones = [recepcion('borrador')]
    montar(['platform.contabilidad.view', K.registrarRecepcion])
    verRecepciones()
    expect(screen.queryByText('Registrar')).toBeNull()
  })

  it('«Cambiar estado» y «Autorizar / Denegar» genéricos + las otras cinco llaves, SIN la de registrar: no se ofrece Registrar', () => {
    m.recepciones = [recepcion('borrador')]
    montar([...VER_Y_EDITAR, ...GENERICOS_APROBAR, ...todasMenos(K.registrarRecepcion)])
    verRecepciones()
    expect(screen.queryByText('Registrar')).toBeNull()
  })

  it('anular una recepción registrada sigue con «Cambiar estado» + «Editar»: la llave de registrar no la da', () => {
    m.recepciones = [recepcion('registrada')]
    const sinGenerico = montar([...VER_Y_EDITAR, K.registrarRecepcion])
    verRecepciones()
    expect(screen.queryByText('Anular')).toBeNull()
    sinGenerico.unmount()

    montar([...VER_Y_EDITAR, 'platform.contabilidad.change_status'])
    verRecepciones()
    expect(screen.getByText('Anular')).toBeTruthy()
  })

  it.each(['admin', 'company_owner', 'super_admin', 'superadmin'])('%s (exento) ve Registrar y Anular sin llaves propias', (rol) => {
    m.recepciones = [recepcion('borrador'), { ...recepcion('registrada'), id: 'r2', numero: 'REC-000002' }]
    montar([], rol)
    verRecepciones()
    expect(screen.getByText('Registrar')).toBeTruthy()
    expect(screen.getByText('Anular')).toBeTruthy()
  })
})
