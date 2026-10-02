// Validación de interfaz del Bloque B: Operaciones mostraba un contador por
// POSICIÓN en la lista («OC-0001» para la orden más antigua, cambiando al agregar
// otra) en vez del número de la orden. La misma orden debe llamarse igual en
// Operaciones, Contabilidad y el seguimiento.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../../../domain/cxp/queries', () => ({ useProveedoresQuery: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../../domain/proveedores/queries', () => ({ useAsignacionesQuery: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: vi.fn(), updateCondominioRow: vi.fn(), deleteCondominioRow: vi.fn(),
}))
vi.mock('../../../compras/SeguimientoOrdenModal', () => ({ SeguimientoOrdenModal: () => null }))

import OrdenesCompraTab from '../OrdenesCompraTab'

const orden = (id: string, numero: string | null, concepto: string) => ({
  id, company_id: 'c1', project_id: 'p1', correlativo: 1, numero, proveedor_id: null, proveedor_nombre: 'Prov',
  concepto, monto_estimado: null, estado: 'emitida', created_at: '2026-10-02T00:00:00Z',
})

afterEach(cleanup)

describe('Operaciones · Órdenes de compra', () => {
  it('muestra el número real de cada orden, no su posición en la lista', () => {
    const ordenes = [orden('o2', 'OC-000007', 'Segunda'), orden('o1', 'OC-000003', 'Primera')] as never
    render(<OrdenesCompraTab ordenes={ordenes} proyectoId="p1" companyId="c1" moneda="GTQ" canCreate={false} canEdit={false} onRefresh={vi.fn()} proveedores={[]} />)
    expect(screen.getByText('OC-000007')).toBeTruthy()
    expect(screen.getByText('OC-000003')).toBeTruthy()
    expect(screen.queryByText('OC-0001')).toBeNull()
    expect(screen.queryByText('OC-0002')).toBeNull()
  })

  it('una orden sin número (previa al ciclo nuevo) lo dice en vez de inventar uno', () => {
    const ordenes = [orden('o1', null, 'Antigua')] as never
    render(<OrdenesCompraTab ordenes={ordenes} proyectoId="p1" companyId="c1" moneda="GTQ" canCreate={false} canEdit={false} onRefresh={vi.fn()} proveedores={[]} />)
    expect(screen.getByText('Sin número')).toBeTruthy()
  })
})
