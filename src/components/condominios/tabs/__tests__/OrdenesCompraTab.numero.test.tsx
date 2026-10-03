// Validación de interfaz del Bloque B: Operaciones mostraba un contador por
// POSICIÓN en la lista («OC-0001» para la orden más antigua, cambiando al agregar
// otra) en vez del número de la orden. La misma orden debe llamarse igual en
// Operaciones, Contabilidad y el seguimiento.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  update: vi.fn(),
  prompt: vi.fn(),
  notify: vi.fn(),
  excepcion: vi.fn(),
  cambiarEstado: true,
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../../../domain/cxp/queries', () => ({ useProveedoresQuery: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../../domain/proveedores/queries', () => ({ useAsignacionesQuery: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../../domain/compras/queries', () => ({ useInsumosAlmacenQuery: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../../domain/compras/mutations', () => ({ crearOrdenTransaccional: vi.fn() }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: vi.fn(), updateCondominioRow: h.update, deleteCondominioRow: vi.fn(),
}))
vi.mock('../../../compras/SeguimientoOrdenModal', () => ({ SeguimientoOrdenModal: () => null }))
vi.mock('../../../proveedores/ContratoSeguimientoModal', () => ({ ContratoSeguimientoModal: () => null }))
vi.mock('../../../proveedores/ContratoSelector', () => ({ ContratoSelector: () => null }))
vi.mock('../../../proveedores/permisos', () => ({ usePermisosProveedor: () => ({ cambiarEstado: h.cambiarEstado }) }))
vi.mock('../../../../domain/proveedores/contratosCompras', async (orig) => ({
  ...(await orig<typeof import('../../../../domain/proveedores/contratosCompras')>()),
  useExcepcionContratoMutation: () => ({ mutateAsync: h.excepcion }),
}))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: h.prompt }))
vi.mock('../../../shared/Dialog', () => ({ confirm: vi.fn(), notify: h.notify }))

import OrdenesCompraTab from '../OrdenesCompraTab'

const orden = (id: string, numero: string | null, concepto: string) => ({
  id, company_id: 'c1', project_id: 'p1', correlativo: 1, numero, proveedor_id: null, proveedor_nombre: 'Prov',
  concepto, monto_estimado: null, estado: 'emitida', created_at: '2026-10-02T00:00:00Z',
})

beforeEach(() => { h.cambiarEstado = true })
afterEach(() => { cleanup(); vi.clearAllMocks() })

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

describe('Operaciones · aprobar una orden amparada en un contrato', () => {
  const NO_VIGENTE = { message: 'COMPRAS_CONTRATO_NO_VIGENTE: no se puede aprobar la orden al amparo de su contrato (no está vigente hoy)' }
  const conContrato = (estado = 'borrador') => [{ ...orden('o1', 'OC-000001', 'Con contrato'), estado, contrato_id: 'k1' }] as never
  const montar = (ordenes: never) => {
    render(<OrdenesCompraTab ordenes={ordenes} proyectoId="p1" companyId="c1" moneda="GTQ" canCreate canEdit onRefresh={vi.fn()} proveedores={[]} />)
    fireEvent.click(screen.getByText('Con contrato'))   // expande la tarjeta
  }

  it('la orden dice que está amparada en un contrato y deja ver su seguimiento', () => {
    montar(conContrato())
    expect(screen.getByTestId('orden-contrato-o1').textContent).toMatch(/Amparada en un contrato/)
  })

  it('contrato no vigente + permiso de cambio de estado: pide el motivo, autoriza la excepción y reintenta', async () => {
    h.update.mockResolvedValueOnce({ error: NO_VIGENTE }).mockResolvedValueOnce({ error: null })
    h.prompt.mockResolvedValueOnce({ motivo: ' Contrato en renovación; el servicio no puede parar ' })
    montar(conContrato())
    fireEvent.click(screen.getByText(/Aprobar/))
    await waitFor(() => expect(h.excepcion).toHaveBeenCalledWith({
      ordenId: 'o1', etapa: 'aprobar', motivo: 'Contrato en renovación; el servicio no puede parar',
    }))
    expect(h.update).toHaveBeenCalledTimes(2)
    expect(h.prompt.mock.calls[0][0].description).toMatch(/queda registrado a tu nombre/)
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Excepción autorizada' })))
  })

  it('emitir usa la etapa «emitir»', async () => {
    h.update.mockResolvedValueOnce({ error: NO_VIGENTE }).mockResolvedValueOnce({ error: null })
    h.prompt.mockResolvedValueOnce({ motivo: 'Se emite hoy; la renovación se firma esta semana' })
    montar(conContrato('aprobada'))
    fireEvent.click(screen.getByText(/Emitir OC/))
    await waitFor(() => expect(h.excepcion).toHaveBeenCalledWith(expect.objectContaining({ etapa: 'emitir' })))
  })

  it('SIN el permiso de cambio de estado no se ofrece la excepción: se muestra el rechazo del servidor', async () => {
    h.cambiarEstado = false
    h.update.mockResolvedValue({ error: NO_VIGENTE })
    montar(conContrato())
    fireEvent.click(screen.getByText(/Aprobar/))
    await waitFor(() => expect(h.notify).toHaveBeenCalled())
    expect(h.notify.mock.calls[0][0].text).toMatch(/COMPRAS_CONTRATO_NO_VIGENTE/)
    expect(h.prompt).not.toHaveBeenCalled()
    expect(h.excepcion).not.toHaveBeenCalled()
  })

  it('si la persona no escribe el motivo no se autoriza nada', async () => {
    h.update.mockResolvedValue({ error: NO_VIGENTE })
    h.prompt.mockResolvedValueOnce(null)
    montar(conContrato())
    fireEvent.click(screen.getByText(/Aprobar/))
    await waitFor(() => expect(h.notify).toHaveBeenCalled())
    expect(h.excepcion).not.toHaveBeenCalled()
    expect(h.update).toHaveBeenCalledTimes(1)
  })

  it('una orden SIN contrato no abre la excepción: el error se muestra', async () => {
    h.update.mockResolvedValue({ error: { message: 'COMPRAS_PROVEEDOR_NO_AUTORIZADO: "X" está suspendido' } })
    render(<OrdenesCompraTab ordenes={[{ ...orden('o9', 'OC-000009', 'Sin contrato'), estado: 'borrador' }] as never} proyectoId="p1" companyId="c1" moneda="GTQ" canCreate canEdit onRefresh={vi.fn()} proveedores={[]} />)
    fireEvent.click(screen.getByText('Sin contrato'))
    fireEvent.click(screen.getByText(/Aprobar/))
    await waitFor(() => expect(h.notify).toHaveBeenCalled())
    expect(h.prompt).not.toHaveBeenCalled()
  })
})
