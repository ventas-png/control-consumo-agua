// CERO FILAS: ninguna de las seis decisiones del circuito de compras y pagos puede mostrarse como hecha si el servidor
// no cambió ninguna fila.
//
// PostgREST devuelve ÉXITO con cero filas cuando la política de filas (RLS) no deja tocar —p. ej. la persona no tiene
// asignado el proyecto del documento, o el documento ya salió del estado de origen (doble clic)—. Antes la pantalla decía
// «Listo» y refrescaba como si hubiera funcionado. Aquí se recorren las seis acciones con las mutaciones REALES (solo el
// cliente de Supabase está simulado):
//   · aprobar una orden de compra · registrar una recepción · aprobar una factura · aprobar una orden de pago ·
//     ejecutar un pago · anular un pago
// y para cada una se exige: con cero filas → aviso de error con el texto de «sin filas», NINGÚN aviso de éxito y
// NINGUNA invalidación de consultas; con una fila → éxito e invalidación (control positivo: sin él la prueba no
// distinguiría un botón roto de uno que protege); con el rechazo de permiso del servidor → su texto, sin el código.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { LLAVES_ACCION_COMPRAS } from '../../../lib/platformPermissions'
import { VER_Y_EDITAR, montarConSesion } from '../../../test/sesionPermisos'

const h = vi.hoisted(() => ({
  filas: [] as unknown[],
  error: null as { message: string } | null,
  parches: [] as Array<{ tabla: string; patch: Record<string, unknown> }>,
  notify: vi.fn(),
  confirm: vi.fn(),
  prompt: vi.fn(),
  ordenes: [] as unknown[],
  recepciones: [] as unknown[],
  facturas: [] as unknown[],
  ordenesPago: [] as unknown[],
}))

vi.mock('../../../lib/supabase', () => {
  const cadena = (tabla: string) => {
    const c: Record<string, unknown> = {}
    const respuesta = () => ({ data: h.filas, error: h.error })
    const fin = { abortSignal: () => Promise.resolve(respuesta()), then: (a: never, b: never) => Promise.resolve(respuesta()).then(a, b) }
    c.update = (patch: Record<string, unknown>) => { h.parches.push({ tabla, patch }); return c }
    c.eq = () => c
    c.select = () => fin
    return c
  }
  return {
    supabase: { from: (t: string) => cadena(t), auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) } },
    warmUpSupabase: vi.fn(),
  }
})

const vacio = { data: [], isLoading: false }
vi.mock('../../../domain/compras/queries', () => ({
  useOrdenesCompraQuery: () => ({ data: h.ordenes, isLoading: false }),
  useRecepcionesQuery: () => ({ data: h.recepciones, isLoading: false }),
  useContrasenasQuery: () => vacio, useActivosFijosQuery: () => vacio, useCompromisosQuery: () => vacio,
  useDuplicadosQuery: () => vacio, useOrdenCompraLineasQuery: () => vacio, useCuadreQuery: () => vacio,
  useInsumosAlmacenQuery: () => vacio,
}))
vi.mock('../../../domain/cxp/queries', () => ({
  useProveedoresQuery: () => ({
    data: [{ id: '11111111-1111-4111-8111-111111111111', nombre: 'Ferretería', estado: 'autorizado', activo: true, autorizacion_vence: null }],
    isLoading: false,
  }),
  useFacturasProveedorQuery: () => ({ data: h.facturas, isLoading: false }),
  useOrdenesPagoQuery: () => ({ data: h.ordenesPago, isLoading: false }),
  useAgingQuery: () => vacio, useProyeccionPagosQuery: () => vacio,
}))
vi.mock('../../../domain/proveedores/queries', () => ({
  useSugerenciaCuentaQuery: () => ({ data: null, isLoading: false, isError: false, error: null }),
  useResponsablesQuery: () => vacio,
  useAsignacionesQuery: () => vacio,
}))
vi.mock('../../shared/PromptDialog', () => ({ openPromptDialog: h.prompt }))
vi.mock('../../shared/Dialog', () => ({ confirm: h.confirm, notify: h.notify }))

import { ComprasTab } from '../ComprasTab'
import { CuentasPorPagarTab } from '../CuentasPorPagarTab'
import OrdenesCompraTab from '../../condominios/tabs/OrdenesCompraTab'

const K = LLAVES_ACCION_COMPRAS
const PROV = '11111111-1111-4111-8111-111111111111'
const PROY = '22222222-2222-4222-8222-222222222222'
const SIN_FILAS = /El servidor no aplicó el cambio/
const RECHAZO_PERMISO = 'COMPRAS_PERMISO_ACCION: para marcar pagada una orden de pago (contabiliza el pago) tu perfil necesita el permiso «Compras y pagos — Ejecutar un pago».'

const orden = (estado: string) => ({
  id: 'o1', numero: 'OC-000001', proveedor_id: PROV, proveedor_nombre: 'Ferretería', concepto: 'Material',
  moneda: 'GTQ', total: 600, estado, contrato_id: null, proveedores: { nombre: 'Ferretería' },
})
const recepcion = (estado: string) => ({
  id: 'r1', numero: 'REC-000001', fecha: '2026-10-01', documento_referencia: 'REM-1', estado, tipo: 'bienes',
  ordenes_compra: { numero: 'OC-000001', concepto: 'Material' },
})
const factura = (estado: string, extra: Record<string, unknown> = {}) => ({
  id: 'f1', proveedores: { nombre: 'Ferretería' }, numero_factura: 'F-1', concepto: 'Material', fecha_vencimiento: '2026-11-01',
  monto_total: 600, monto_pagado: 0, moneda: 'GTQ', estado, orden_compra_id: null, ...extra,
})
const ordenPago = (estado: string) => ({
  id: 'op1', proveedores: { nombre: 'Ferretería' }, facturas_proveedor: { numero_factura: 'F-1', concepto: 'Material' },
  metodo_pago: 'transferencia', monto: 600, fecha_pago: null, estado, referencia: null,
})

const compras = () => <ComprasTab companyId="c1" projectId={PROY} monedaBase="GTQ" />
const cxp = () => <CuentasPorPagarTab companyId="c1" projectId={PROY} monedaBase="GTQ" />

interface Caso {
  nombre: string
  llave: string
  tabla: string
  /** Lo que el UPDATE debe escribir en `estado`. */
  estado: string
  ui: () => ReactElement
  datos: () => void
  vista?: () => void
  clic: () => void
}

const casos: Caso[] = [
  {
    nombre: 'aprobar una orden de compra', llave: K.aprobarOrdenCompra, tabla: 'ordenes_compra', estado: 'aprobada',
    ui: compras, datos: () => { h.ordenes = [orden('borrador')] },
    clic: () => fireEvent.click(screen.getByText('Aprobar')),
  },
  {
    nombre: 'registrar una recepción', llave: K.registrarRecepcion, tabla: 'recepciones', estado: 'registrada',
    ui: compras, datos: () => { h.recepciones = [recepcion('borrador')] },
    vista: () => fireEvent.click(screen.getByRole('radio', { name: /Recepciones/ })),
    clic: () => fireEvent.click(screen.getByText('Registrar')),
  },
  {
    nombre: 'aprobar una factura de proveedor', llave: K.aprobarFactura, tabla: 'facturas_proveedor', estado: 'aprobada',
    ui: cxp, datos: () => { h.facturas = [factura('registrada')] },
    clic: () => fireEvent.click(screen.getByText('Aprobar')),
  },
  {
    nombre: 'aprobar una factura de proveedor con orden de compra (cuadre de 3 vías)', llave: K.aprobarFactura, tabla: 'facturas_proveedor', estado: 'aprobada',
    ui: cxp, datos: () => { h.facturas = [factura('registrada', { orden_compra_id: 'oc1' })] },
    clic: () => {
      fireEvent.click(screen.getByText('Revisar y aprobar'))
      fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }))
    },
  },
  {
    nombre: 'aprobar una orden de pago', llave: K.aprobarOrdenPago, tabla: 'ordenes_pago', estado: 'aprobada',
    ui: cxp, datos: () => { h.ordenesPago = [ordenPago('borrador')] },
    vista: () => fireEvent.click(screen.getByRole('radio', { name: /Órdenes de pago/ })),
    clic: () => fireEvent.click(screen.getByText('Aprobar')),
  },
  {
    nombre: 'ejecutar un pago', llave: K.ejecutarPago, tabla: 'ordenes_pago', estado: 'pagada',
    ui: cxp, datos: () => { h.ordenesPago = [ordenPago('aprobada')] },
    vista: () => fireEvent.click(screen.getByRole('radio', { name: /Órdenes de pago/ })),
    clic: () => fireEvent.click(screen.getByText('Marcar pagada')),
  },
  {
    nombre: 'anular un pago', llave: K.anularPago, tabla: 'ordenes_pago', estado: 'anulada',
    ui: cxp, datos: () => { h.ordenesPago = [ordenPago('pagada')] },
    vista: () => fireEvent.click(screen.getByRole('radio', { name: /Órdenes de pago/ })),
    clic: () => fireEvent.click(screen.getByText('Anular')),
  },
]

/** Monta la pantalla del caso con SOLO su llave (+ ver y editar) y espía las invalidaciones de consultas. */
function arrancar(c: Caso) {
  c.datos()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const invalidar = vi.spyOn(qc, 'invalidateQueries')
  montarConSesion(c.ui(), { permisos: [...VER_Y_EDITAR, c.llave], queryClient: qc })
  c.vista?.()
  return invalidar
}

const textoDeAvisos = (variante: string) =>
  h.notify.mock.calls.map(([o]) => o as { variant: string; text: string }).filter((o) => o.variant === variante).map((o) => o.text)

beforeEach(() => {
  h.filas = []; h.error = null; h.parches = []
  h.ordenes = []; h.recepciones = []; h.facturas = []; h.ordenesPago = []
  h.confirm.mockResolvedValue({ isConfirmed: true })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('las seis acciones desde la pantalla: cero filas NO es éxito', () => {
  it.each(casos)('$nombre: con cero filas muestra el error, ningún éxito y no invalida', async (c) => {
    h.filas = []
    const invalidar = arrancar(c)
    c.clic()
    await waitFor(() => expect(textoDeAvisos('error')).toHaveLength(1))
    expect(textoDeAvisos('error')[0]).toMatch(SIN_FILAS)
    expect(textoDeAvisos('success')).toEqual([])
    expect(invalidar).not.toHaveBeenCalled()
    // el UPDATE sí se intentó, sobre la tabla y con el estado de la acción
    expect(h.parches).toHaveLength(1)
    expect(h.parches[0].tabla).toBe(c.tabla)
    expect(h.parches[0].patch.estado).toBe(c.estado)
  })

  it.each(casos)('$nombre: con una fila afectada es éxito e invalida las consultas (control positivo)', async (c) => {
    h.filas = [{ id: 'x' }]
    const invalidar = arrancar(c)
    c.clic()
    await waitFor(() => expect(textoDeAvisos('success')).toHaveLength(1))
    expect(textoDeAvisos('error')).toEqual([])
    expect(invalidar).toHaveBeenCalled()
    expect(h.parches[0].tabla).toBe(c.tabla)
    expect(h.parches[0].patch.estado).toBe(c.estado)
  })

  it.each(casos)('$nombre: si el servidor rechaza por permiso, se muestra SU texto (sin el código) y nada de éxito', async (c) => {
    h.error = { message: RECHAZO_PERMISO }
    const invalidar = arrancar(c)
    c.clic()
    await waitFor(() => expect(textoDeAvisos('error')).toHaveLength(1))
    expect(textoDeAvisos('error')[0]).toBe('Para marcar pagada una orden de pago (contabiliza el pago) tu perfil necesita el permiso «Compras y pagos — Ejecutar un pago».')
    expect(textoDeAvisos('success')).toEqual([])
    expect(invalidar).not.toHaveBeenCalled()
  })

  it('«Cancelar» en la confirmación de anular un pago no escribe nada', async () => {
    h.confirm.mockResolvedValue({ isConfirmed: false })
    const c = casos[casos.length - 1]
    arrancar(c)
    c.clic()
    await waitFor(() => expect(h.confirm).toHaveBeenCalled())
    await Promise.resolve()
    expect(h.parches).toEqual([])
    expect(h.notify).not.toHaveBeenCalled()
  })
})

// La orden de compra también se aprueba desde Operaciones (pestaña «Órdenes compra»), con otra capa de escritura
// (`updateCondominioRowAfectando`): mismo contrato, y no refresca la lista si no cambió nada.
describe('Operaciones › Órdenes compra: aprobar y devolver con cero filas NO es éxito', () => {
  const ordenOp = (estado: string) => ({
    id: 'o1', company_id: 'c1', project_id: 'p1', correlativo: 1, numero: 'OC-000001', proveedor_id: null, proveedor_nombre: 'Prov',
    concepto: 'Compra X', monto_estimado: null, estado, created_at: '2026-10-02T00:00:00Z',
  })
  const montarOp = (estado: string, onRefresh = vi.fn()) => {
    montarConSesion(
      <OrdenesCompraTab ordenes={[ordenOp(estado)] as never} proyectoId="p1" companyId="c1" moneda="GTQ" canCreate canEdit onRefresh={onRefresh} proveedores={[]} />,
      { permisos: [...VER_Y_EDITAR, K.aprobarOrdenCompra] },
    )
    fireEvent.click(screen.getByText('Compra X'))
    return onRefresh
  }

  it('aprobar con cero filas: error visible, sin refrescar', async () => {
    h.filas = []
    const onRefresh = montarOp('borrador')
    fireEvent.click(screen.getByText(/Aprobar/))
    await waitFor(() => expect(textoDeAvisos('error')).toHaveLength(1))
    expect(textoDeAvisos('error')[0]).toMatch(SIN_FILAS)
    expect(onRefresh).not.toHaveBeenCalled()
    expect(h.parches[0]).toMatchObject({ tabla: 'ordenes_compra', patch: { estado: 'aprobada' } })
  })

  it('aprobar con una fila afectada: refresca (control positivo)', async () => {
    h.filas = [{ id: 'o1' }]
    const onRefresh = montarOp('borrador')
    fireEvent.click(screen.getByText(/Aprobar/))
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1))
    expect(textoDeAvisos('error')).toEqual([])
  })

  it('devolver a borrador con cero filas: error visible, sin refrescar', async () => {
    h.filas = []
    h.prompt.mockResolvedValueOnce({ motivo: 'Corregir el precio del renglón 2' })
    const onRefresh = montarOp('aprobada')
    fireEvent.click(screen.getByText(/Devolver a borrador/))
    await waitFor(() => expect(textoDeAvisos('error')).toHaveLength(1))
    expect(textoDeAvisos('error')[0]).toMatch(SIN_FILAS)
    expect(onRefresh).not.toHaveBeenCalled()
    expect(h.parches[0]).toMatchObject({ tabla: 'ordenes_compra', patch: { estado: 'borrador' } })
  })

  it('si el servidor rechaza por permiso se muestra su texto, sin el código', async () => {
    h.error = { message: 'COMPRAS_PERMISO_ACCION: para aprobar una orden de compra tu perfil necesita el permiso «Autorizar / Denegar — Órdenes compra».' }
    const onRefresh = montarOp('borrador')
    fireEvent.click(screen.getByText(/Aprobar/))
    await waitFor(() => expect(textoDeAvisos('error')).toHaveLength(1))
    expect(textoDeAvisos('error')[0]).toBe('Para aprobar una orden de compra tu perfil necesita el permiso «Autorizar / Denegar — Órdenes compra».')
    expect(onRefresh).not.toHaveBeenCalled()
  })
})
