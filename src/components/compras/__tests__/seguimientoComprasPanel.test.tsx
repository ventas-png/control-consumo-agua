// Seguimiento de compras (pantalla filtrable). Se fija lo que una persona VE: los filtros llegan al
// servidor, cada fila va en la moneda de su orden y los totales se agrupan POR MONEDA (nunca se suman
// monedas), y quien no ve Contabilidad ni siquiera ve las columnas financieras. Quién ve qué lo decide
// el servidor (supabase/tests/compras_bloque_b/assert_seguimiento_pantalla.sql).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))

const m = vi.hoisted(() => ({ filas: [] as unknown[], filtros: vi.fn() }))
vi.mock('../../../domain/compras/queries', () => ({
  useSeguimientoListaQuery: (_c: string, f: unknown) => { m.filtros(f); return { data: m.filas, isLoading: false, isError: false } },
  useSeguimientoOrdenQuery: () => ({ data: undefined, isLoading: true, error: null }),
}))
vi.mock('../../../domain/cxp/queries', () => ({
  useProveedoresQuery: () => ({ data: [{ id: 'pv1', nombre: 'Ferretería' }, { id: 'pv2', nombre: 'Servicios' }] }),
}))
vi.mock('../../../domain/agua/queries', () => ({
  useProyectosQuery: () => ({ data: [{ id: 'p1', nombre: 'Condominio Norte' }, { id: 'p2', nombre: 'Condominio Sur' }] }),
}))

import { SeguimientoComprasPanel, totalesPorMoneda } from '../SeguimientoComprasPanel'
import type { FilaSeguimiento } from '../../../types/compras'

const fila = (extra: Partial<FilaSeguimiento>): FilaSeguimiento => ({
  orden_id: 'o1', numero: 'OC-000001', concepto: 'Cloro', estado: 'recibida', project_id: 'p1', proveedor_id: 'pv1',
  proveedor: 'Ferretería', moneda: 'GTQ', fecha: '2026-10-01', comprometido: 1120, comprometido_neto: 1000, recibido: 1000,
  facturado: 672, facturado_neto: 600, pagado: 300, pendiente_por_recibir: 0, pendiente_por_facturar: 400,
  pendiente_por_pagar: 372, n_recepciones: 2, n_facturas: 1, diferencia_precio_facturada: -50, ...extra,
})

beforeEach(() => { m.filas = [fila({}), fila({ orden_id: 'o2', numero: 'OC-000002', moneda: 'USD', comprometido: 112, comprometido_neto: 100, recibido: 100, facturado: 112, facturado_neto: 100, pagado: 0, pendiente_por_facturar: 0, pendiente_por_pagar: 112 })] })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('totalesPorMoneda', () => {
  it('NO suma monedas distintas: un total por cada una', () => {
    const t = totalesPorMoneda(m.filas as FilaSeguimiento[])
    expect(t.map((x) => x.moneda)).toEqual(['GTQ', 'USD'])
    expect(t[0].comprometido).toBe(1120)
    expect(t[1].comprometido).toBe(112)
    expect(t[0].facturado).toBe(672)
  })
  it('suma dentro de la MISMA moneda y respeta los null (sin acceso a Contabilidad)', () => {
    const t = totalesPorMoneda([fila({ facturado: null, pagado: null, pendiente_por_facturar: null, pendiente_por_pagar: null }), fila({ orden_id: 'o9', facturado: null, pagado: null, pendiente_por_facturar: null, pendiente_por_pagar: null })])
    expect(t).toHaveLength(1)
    expect(t[0].ordenes).toBe(2)
    expect(t[0].comprometido).toBe(2240)
    expect(t[0].facturado).toBeNull()
    expect(t[0].pagado).toBeNull()
  })
})

describe('Seguimiento de compras', () => {
  it('muestra comprometido, recibido, facturado, pagado y los tres pendientes, por separado', () => {
    render(<SeguimientoComprasPanel companyId="c1" projectId="p1" monedaBase="GTQ" />)
    for (const h of ['Comprometido', 'Recibido', 'Facturado', 'Pagado', 'Pend. recibir', 'Pend. facturar', 'Pend. pagar']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(h) })).toBeTruthy()
    }
  })

  it('con dos monedas: un total por moneda, un aviso de que no se convierten y cada fila con su moneda', () => {
    render(<SeguimientoComprasPanel companyId="c1" projectId="p1" monedaBase="GTQ" />)
    expect(screen.getByTestId('total-GTQ').textContent).toMatch(/1 orden/)
    expect(screen.getByTestId('total-USD').textContent).toMatch(/US\$|USD/)
    expect(screen.getByText(/No se convierten ni se suman entre sí/)).toBeTruthy()
    const f2 = screen.getByText('OC-000002').closest('tr')!
    expect(within(f2).getByText('USD')).toBeTruthy()
  })

  it('SIN acceso a Contabilidad no dibuja las columnas de facturado, pagado ni pendientes financieros', () => {
    m.filas = [fila({ facturado: null, facturado_neto: null, pagado: null, pendiente_por_facturar: null, pendiente_por_pagar: null, n_facturas: null })]
    render(<SeguimientoComprasPanel companyId="c1" projectId="p1" monedaBase="GTQ" />)
    expect(screen.queryByRole('columnheader', { name: /Facturado/ })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: /Pagado/ })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: /Pend. facturar/ })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: /Pend. pagar/ })).toBeNull()
    expect(screen.getByRole('columnheader', { name: /Recibido/ })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: /Pend. recibir/ })).toBeTruthy()
    expect(screen.getByTestId('sin-finanzas')).toBeTruthy()
  })

  it('los filtros viajan al servidor (proyecto, proveedor, estado y fechas)', () => {
    render(<SeguimientoComprasPanel companyId="c1" projectId="p1" monedaBase="GTQ" />)
    expect(m.filtros).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'p1', soloEmpresa: false }))
    fireEvent.change(screen.getByLabelText('Filtrar por proveedor'), { target: { value: 'pv2' } })
    fireEvent.change(screen.getByLabelText('Filtrar por estado'), { target: { value: 'cerrada' } })
    fireEvent.change(screen.getByLabelText('Fecha desde'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('Fecha hasta'), { target: { value: '2026-10-31' } })
    expect(m.filtros).toHaveBeenLastCalledWith(expect.objectContaining({ proveedorId: 'pv2', estado: 'cerrada', desde: '2026-10-01', hasta: '2026-10-31' }))
    fireEvent.change(screen.getByLabelText('Filtrar por proyecto'), { target: { value: 'p2' } })
    expect(m.filtros).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'p2', soloEmpresa: false }))
    fireEvent.change(screen.getByLabelText('Filtrar por proyecto'), { target: { value: 'empresa' } })
    expect(m.filtros).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: null, soloEmpresa: true }))
    fireEvent.change(screen.getByLabelText('Filtrar por proyecto'), { target: { value: 'todos' } })
    expect(m.filtros).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: null, soloEmpresa: false }))
  })

  it('«Ver detalle» abre el seguimiento de ESA orden (enlace orden → recepciones → facturas → pagos)', () => {
    render(<SeguimientoComprasPanel companyId="c1" projectId="p1" monedaBase="GTQ" />)
    fireEvent.click(within(screen.getByText('OC-000001').closest('tr')!).getByText('Ver detalle'))
    expect(screen.getByText(/Seguimiento de la orden/)).toBeTruthy()
  })
})
