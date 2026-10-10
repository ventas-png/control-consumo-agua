// Botones de PASO de Cuentas por pagar alineados con lo que el servidor exige de verdad.
//
// Cada decisión de la factura y del pago tiene SU llave, y todas piden además «Editar» de Contabilidad (la política de
// UPDATE de esas tablas):
//   · aprobar la factura de proveedor  → «Compras y pagos — Aprobar una factura de proveedor»;
//   · aprobar la orden de pago         → «Compras y pagos — Aprobar una orden de pago»;
//   · marcar pagada la orden de pago   → «Compras y pagos — Ejecutar un pago»;
//   · anular la orden de pago          → «Compras y pagos — Anular un pago» (en cualquier estado);
//   · anular la FACTURA                → sigue con «Cambiar estado» de Contabilidad.
// Los genéricos «Autorizar / Denegar» y «Cambiar estado» ya no conceden aprobar, pagar ni anular un pago. Una persona
// con UNA llave ve SOLO el botón de esa acción. Se prueba con las llaves RBAC reales de la sesión.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { LLAVES_ACCION_COMPRAS } from '../../../lib/platformPermissions'
import { GENERICOS_APROBAR, VER_Y_EDITAR, montarConSesion } from '../../../test/sesionPermisos'

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))

const m = vi.hoisted(() => ({
  aprobarFactura: vi.fn(),
  anularFactura: vi.fn(),
  aprobarOrden: vi.fn(),
  pagarOrden: vi.fn(),
  anularOrden: vi.fn(),
  confirm: vi.fn(),
  notify: vi.fn(),
  facturas: [] as unknown[],
  ordenes: [] as unknown[],
}))

const vacio = { data: [], isLoading: false }
vi.mock('../../../domain/cxp/queries', () => ({
  useProveedoresQuery: () => ({ data: [], isLoading: false }),
  useFacturasProveedorQuery: () => ({ data: m.facturas, isLoading: false }),
  useOrdenesPagoQuery: () => ({ data: m.ordenes, isLoading: false }),
  useAgingQuery: () => vacio, useProyeccionPagosQuery: () => vacio,
}))
vi.mock('../../../domain/cxp/mutations', () => ({
  useAprobarFacturaMutation: () => ({ mutateAsync: m.aprobarFactura, isPending: false }),
  useAnularFacturaMutation: () => ({ mutateAsync: m.anularFactura, isPending: false }),
  useAprobarOrdenMutation: () => ({ mutateAsync: m.aprobarOrden, isPending: false }),
  useMarcarOrdenPagadaMutation: () => ({ mutateAsync: m.pagarOrden, isPending: false }),
  useAnularOrdenMutation: () => ({ mutateAsync: m.anularOrden, isPending: false }),
  useCrearFacturaProveedorMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCrearOrdenPagoMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../../../domain/compras/queries', () => ({
  useOrdenesCompraQuery: () => vacio, useOrdenCompraLineasQuery: () => vacio, useCuadreQuery: () => vacio,
}))
vi.mock('../../../domain/compras/mutations', () => ({
  useAprobarFacturaConCuadreMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCrearContrasenaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../../shared/Dialog', () => ({ confirm: m.confirm, notify: m.notify }))

import { CuentasPorPagarTab } from '../CuentasPorPagarTab'

const K = LLAVES_ACCION_COMPRAS
const OTRAS = (llave: string) => Object.values(K).filter((k) => k !== llave)

const factura = (estado: string, extra: Record<string, unknown> = {}) => ({
  id: 'f1', proveedores: { nombre: 'Ferretería' }, numero_factura: 'F-1', concepto: 'Material', fecha_vencimiento: '2026-11-01',
  monto_total: 600, monto_pagado: 0, moneda: 'GTQ', estado, orden_compra_id: null, ...extra,
})
const ordenPago = (estado: string) => ({
  id: 'op1', proveedores: { nombre: 'Ferretería' }, facturas_proveedor: { numero_factura: 'F-1', concepto: 'Material' },
  metodo_pago: 'transferencia', monto: 600, fecha_pago: null, estado, referencia: null,
})

const montar = (permisos: readonly string[], role = 'operator') =>
  montarConSesion(<CuentasPorPagarTab companyId="c1" projectId="22222222-2222-4222-8222-222222222222" monedaBase="GTQ" />, { permisos, role })
const verOrdenesDePago = () => fireEvent.click(screen.getByRole('radio', { name: /Órdenes de pago/ }))

beforeEach(() => {
  m.facturas = []; m.ordenes = []
  for (const f of [m.aprobarFactura, m.anularFactura, m.aprobarOrden, m.pagarOrden, m.anularOrden]) f.mockResolvedValue(undefined)
  m.confirm.mockResolvedValue({ isConfirmed: true })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Cuentas por pagar · facturas: aprobar tiene su llave; anular sigue con «Cambiar estado»', () => {
  it('factura sin orden: con la llave de aprobar facturas y «Editar» se ofrece Aprobar, y el clic aprueba esa factura', async () => {
    m.facturas = [factura('registrada')]
    montar([...VER_Y_EDITAR, K.aprobarFactura])
    fireEvent.click(screen.getByText('Aprobar'))
    await waitFor(() => expect(m.aprobarFactura).toHaveBeenCalledWith('f1'))
  })

  it('factura con orden de compra: se ofrece «Revisar y aprobar» (cuadre de 3 vías) con la misma llave', () => {
    m.facturas = [factura('registrada', { orden_compra_id: 'oc1' })]
    montar([...VER_Y_EDITAR, K.aprobarFactura])
    expect(screen.getByText('Revisar y aprobar')).toBeTruthy()
    expect(screen.queryByText('Aprobar')).toBeNull()
  })

  it.each([
    ['sin orden', 'Aprobar', null],
    ['con orden de compra', 'Revisar y aprobar', 'oc1'],
  ])('factura %s: con la llave pero SIN «Editar» no se ofrece', (_n, texto, oc) => {
    m.facturas = [factura('registrada', { orden_compra_id: oc })]
    montar(['platform.contabilidad.view', K.aprobarFactura])
    expect(screen.queryByText(texto)).toBeNull()
  })

  it.each([
    ['sin orden', 'Aprobar', null],
    ['con orden de compra', 'Revisar y aprobar', 'oc1'],
  ])('factura %s: genéricos «Autorizar / Denegar» y «Cambiar estado» + las otras cinco llaves, SIN la de aprobar facturas: no se ofrece', (_n, texto, oc) => {
    m.facturas = [factura('registrada', { orden_compra_id: oc })]
    montar([...VER_Y_EDITAR, ...GENERICOS_APROBAR, ...OTRAS(K.aprobarFactura)])
    expect(screen.queryByText(texto)).toBeNull()
  })

  it('anular la factura sigue con «Cambiar estado» + «Editar»: la llave de aprobar no la da, el genérico sí', () => {
    m.facturas = [factura('registrada')]
    const soloLlave = montar([...VER_Y_EDITAR, K.aprobarFactura])
    expect(screen.queryByText('Anular')).toBeNull()
    soloLlave.unmount()

    montar([...VER_Y_EDITAR, 'platform.contabilidad.change_status'])
    expect(screen.getByText('Anular')).toBeTruthy()
    expect(screen.queryByText('Aprobar')).toBeNull()
  })

  it.each(['admin', 'company_owner', 'super_admin', 'superadmin'])('%s (exento) ve Aprobar y Anular la factura sin llaves propias', (rol) => {
    m.facturas = [factura('registrada')]
    montar([], rol)
    expect(screen.getByText('Aprobar')).toBeTruthy()
    expect(screen.getByText('Anular')).toBeTruthy()
  })
})

describe('Cuentas por pagar · órdenes de pago: aprobar, pagar y anular son tres llaves distintas', () => {
  it('borrador: SOLO la llave de aprobar ofrece Aprobar (no Anular), y el clic aprueba esa orden', async () => {
    m.ordenes = [ordenPago('borrador')]
    montar([...VER_Y_EDITAR, K.aprobarOrdenPago])
    verOrdenesDePago()
    expect(screen.queryByText('Anular')).toBeNull()
    fireEvent.click(screen.getByText('Aprobar'))
    await waitFor(() => expect(m.aprobarOrden).toHaveBeenCalledWith('op1'))
  })

  it('aprobada: SOLO la llave de ejecutar pagos ofrece «Marcar pagada» (no Anular), y el clic la paga', async () => {
    m.ordenes = [ordenPago('aprobada')]
    montar([...VER_Y_EDITAR, K.ejecutarPago])
    verOrdenesDePago()
    expect(screen.queryByText('Anular')).toBeNull()
    fireEvent.click(screen.getByText('Marcar pagada'))
    await waitFor(() => expect(m.pagarOrden).toHaveBeenCalledWith({ ordenId: 'op1' }))
  })

  it.each(['borrador', 'aprobada', 'pagada'])('orden %s: SOLO la llave de anular pagos ofrece Anular (ni Aprobar ni Marcar pagada), y el clic anula', async (estado) => {
    m.ordenes = [ordenPago(estado)]
    montar([...VER_Y_EDITAR, K.anularPago])
    verOrdenesDePago()
    expect(screen.queryByText('Aprobar')).toBeNull()
    expect(screen.queryByText('Marcar pagada')).toBeNull()
    fireEvent.click(screen.getByText('Anular'))
    await waitFor(() => expect(m.anularOrden).toHaveBeenCalledWith('op1'))
  })

  it.each([
    ['borrador', K.aprobarOrdenPago, 'Aprobar'],
    ['aprobada', K.ejecutarPago, 'Marcar pagada'],
    ['aprobada', K.anularPago, 'Anular'],
    ['pagada', K.anularPago, 'Anular'],
  ])('orden %s: con las otras cinco llaves y los genéricos pero SIN «%s» no se ofrece «%s»', (estado, llave, texto) => {
    m.ordenes = [ordenPago(estado)]
    montar([...VER_Y_EDITAR, ...GENERICOS_APROBAR, ...OTRAS(llave)])
    verOrdenesDePago()
    expect(screen.queryByText(texto)).toBeNull()
  })

  it.each([
    ['borrador', K.aprobarOrdenPago, 'Aprobar'],
    ['aprobada', K.ejecutarPago, 'Marcar pagada'],
    ['aprobada', K.anularPago, 'Anular'],
  ])('orden %s: con la llave (%s) pero SIN «Editar» no se ofrece «%s»', (estado, llave, texto) => {
    m.ordenes = [ordenPago(estado)]
    montar(['platform.contabilidad.view', llave])
    verOrdenesDePago()
    expect(screen.queryByText(texto)).toBeNull()
  })

  it('los genéricos «Autorizar / Denegar» y «Cambiar estado» + «Editar», sin ninguna llave de pago, no ofrecen nada', () => {
    m.ordenes = [ordenPago('borrador'), { ...ordenPago('aprobada'), id: 'op2' }, { ...ordenPago('pagada'), id: 'op3' }]
    montar([...VER_Y_EDITAR, ...GENERICOS_APROBAR])
    verOrdenesDePago()
    expect(screen.queryByText('Aprobar')).toBeNull()
    expect(screen.queryByText('Marcar pagada')).toBeNull()
    expect(screen.queryByText('Anular')).toBeNull()
  })

  it.each(['admin', 'company_owner', 'super_admin', 'superadmin'])('%s (exento) ve aprobar, pagar y anular sin llaves propias', (rol) => {
    m.ordenes = [ordenPago('borrador'), { ...ordenPago('aprobada'), id: 'op2' }]
    montar([], rol)
    verOrdenesDePago()
    expect(screen.getByText('Aprobar')).toBeTruthy()
    expect(screen.getByText('Marcar pagada')).toBeTruthy()
    expect(screen.getAllByText('Anular')).toHaveLength(2)
  })
})
