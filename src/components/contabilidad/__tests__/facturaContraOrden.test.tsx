// Bloque B (#911) · validación de interfaz — «Registrar factura» permite ligar la
// factura a una orden con algo recibido y capturarla POR RENGLÓN (contra lo
// recibido y no facturado). Antes no había forma de facturar contra una orden
// desde la interfaz, así que el cuadre de 3 vías solo era alcanzable por SQL.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))

const PROV = '11111111-1111-4111-8111-111111111111'
const PROY = '22222222-2222-4222-8222-222222222222'
const ORDEN = '33333333-3333-4333-8333-333333333333'
const L1 = '44444444-4444-4444-8444-444444444441'
const L2 = '44444444-4444-4444-8444-444444444442'
const L3 = '44444444-4444-4444-8444-444444444443'

const m = vi.hoisted(() => ({ crear: vi.fn(), ordenes: [] as unknown[], lineas: [] as unknown[] }))

vi.mock('../../../domain/cxp/queries', () => ({
  useProveedoresQuery: () => ({
    data: [{ id: '11111111-1111-4111-8111-111111111111', nombre: 'Proveedor ZZ', activo: true, dias_credito: 0, categoria_default: 'otros' }],
    isLoading: false,
  }),
}))
vi.mock('../../../domain/cxp/mutations', () => ({
  useCrearFacturaProveedorMutation: () => ({ mutateAsync: m.crear, isPending: false }),
}))
vi.mock('../../../domain/compras/queries', () => ({
  useOrdenesCompraQuery: () => ({ data: m.ordenes, isLoading: false }),
  useOrdenCompraLineasQuery: (id?: string) => ({ data: id ? m.lineas : [], isLoading: false }),
  useCuadreQuery: () => ({ data: [], isLoading: false }),
}))
vi.mock('../../../domain/compras/mutations', () => ({
  useAprobarFacturaConCuadreMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCrearContrasenaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

import { FacturaFormModal } from '../CuentasPorPagarTab'

const orden = (extra: Record<string, unknown> = {}) => ({
  id: ORDEN, proveedor_id: PROV, project_id: PROY, numero: 'OC-000001', concepto: 'Mantenimiento y bombas',
  estado: 'recibida', moneda: null, total: 1456, ...extra,
})
const linea = (id: string, descripcion: string, extra: Record<string, unknown>) => ({
  id, descripcion, unidad: 'u', cantidad: 2, precio_unitario: 500, iva_monto: 120,
  cantidad_recibida: 2, cantidad_facturada: 0, ...extra,
})

function abrir() {
  render(<FacturaFormModal companyId="c1" projectId={PROY} monedaBase="GTQ" onClose={vi.fn()} />)
  fireEvent.change(screen.getByLabelText(/Proveedor/), { target: { value: PROV } })
}

beforeEach(() => {
  m.crear.mockResolvedValue(undefined)
  m.ordenes = [orden()]
  m.lineas = [linea(L1, 'Bombas', {}), linea(L2, 'Mantenimiento', { cantidad: 1, precio_unitario: 300, iva_monto: 36, cantidad_recibida: 1 })]
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Registrar factura: contra una orden', () => {
  it('ofrece solo órdenes del proveedor, de ESTA contabilidad y con algo recibido', () => {
    m.ordenes = [
      orden(),
      orden({ id: 'o2', numero: 'OC-000002', estado: 'emitida' }),                 // nada recibido
      orden({ id: 'o3', numero: 'OC-000003', project_id: null }),                  // otra contabilidad
      orden({ id: 'o4', numero: 'OC-000004', proveedor_id: 'otro-proveedor' }),    // otro proveedor
      orden({ id: 'o5', numero: 'OC-000005', estado: 'cancelada' }),
    ]
    abrir()
    const opciones = Array.from(screen.getByLabelText('Orden de compra a facturar').querySelectorAll('option')).map((o) => o.textContent ?? '')
    expect(opciones).toHaveLength(2) // «Sin orden» + OC-000001
    expect(opciones[1]).toMatch(/OC-000001/)
  })

  it('precarga lo recibido y no facturado, calcula el total y guarda cabecera ligada + renglones', async () => {
    abrir()
    fireEvent.change(screen.getByLabelText('Orden de compra a facturar'), { target: { value: ORDEN } })
    expect(screen.getByText(/Total de la factura/).textContent).toMatch(/1,456\.00/)
    // El monto manual desaparece: con orden el total sale de los renglones.
    expect(screen.queryByText(/Monto total/)).toBeNull()

    fireEvent.click(screen.getByText('Registrar'))
    await waitFor(() => expect(m.crear).toHaveBeenCalled())
    const input = m.crear.mock.calls[0][0] as Record<string, unknown> & { renglones: Record<string, unknown>[] }
    expect(input).toMatchObject({ orden_compra_id: ORDEN, proveedor_id: PROV, monto_total: 1456, iva_monto: 156, moneda: null })
    expect(input.renglones).toEqual([
      { orden_compra_linea_id: L1, descripcion: 'Bombas', cantidad: 2, precio_unitario: 500, iva_monto: 120 },
      { orden_compra_linea_id: L2, descripcion: 'Mantenimiento', cantidad: 1, precio_unitario: 300, iva_monto: 36 },
    ])
  })

  it('factura parcial: solo lo recibido que aún no se facturó, con el IVA prorrateado', async () => {
    m.lineas = [linea(L3, 'Bombas', { cantidad_recibida: 2, cantidad_facturada: 1 })] // por facturar: 1
    abrir()
    fireEvent.change(screen.getByLabelText('Orden de compra a facturar'), { target: { value: ORDEN } })
    expect((screen.getByLabelText('Cantidad a facturar de Bombas') as HTMLInputElement).value).toBe('1')
    expect((screen.getByLabelText('IVA facturado de Bombas') as HTMLInputElement).value).toBe('60')
    fireEvent.click(screen.getByText('Registrar'))
    await waitFor(() => expect(m.crear).toHaveBeenCalled())
    const input = m.crear.mock.calls[0][0] as { monto_total: number; iva_monto: number; renglones: { cantidad: number }[] }
    expect(input.renglones[0].cantidad).toBe(1)
    expect([input.monto_total, input.iva_monto]).toEqual([560, 60])
  })

  it('un precio distinto al de la orden se manda tal cual: el servidor lo marca al cuadrar, no la pantalla', async () => {
    abrir()
    fireEvent.change(screen.getByLabelText('Orden de compra a facturar'), { target: { value: ORDEN } })
    fireEvent.change(screen.getByLabelText('Precio facturado de Bombas'), { target: { value: '600' } })
    fireEvent.click(screen.getByText('Registrar'))
    await waitFor(() => expect(m.crear).toHaveBeenCalled())
    const input = m.crear.mock.calls[0][0] as { renglones: { precio_unitario: number }[] }
    expect(input.renglones[0].precio_unitario).toBe(600)
  })

  it('sin cantidad a facturar en ningún renglón no guarda', async () => {
    abrir()
    fireEvent.change(screen.getByLabelText('Orden de compra a facturar'), { target: { value: ORDEN } })
    fireEvent.change(screen.getByLabelText('Cantidad a facturar de Bombas'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('Cantidad a facturar de Mantenimiento'), { target: { value: '0' } })
    fireEvent.click(screen.getByText('Registrar'))
    await Promise.resolve()
    expect(m.crear).not.toHaveBeenCalled()
  })

  it('sin orden sigue siendo un gasto directo: monto manual y sin renglones', async () => {
    abrir()
    fireEvent.change(screen.getByLabelText(/Concepto/), { target: { value: 'Papelería' } })
    fireEvent.change(screen.getByLabelText(/Monto total/), { target: { value: '100' } })
    fireEvent.click(screen.getByText('Registrar'))
    await waitFor(() => expect(m.crear).toHaveBeenCalled())
    const input = m.crear.mock.calls[0][0] as Record<string, unknown>
    expect(input.orden_compra_id).toBeNull()
    expect(input.renglones).toBeUndefined()
    expect(input.monto_total).toBe(100)
  })
})
