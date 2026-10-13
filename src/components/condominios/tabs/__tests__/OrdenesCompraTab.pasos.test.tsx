// Operaciones › Órdenes compra: qué botones de PASO se ofrecen según las llaves RBAC REALES de la sesión.
//
// El servidor exige, para APROBAR una orden y para DEVOLVER una aprobada a borrador, la llave de la pestaña
// («Autorizar / Denegar — Órdenes compra», condominios.tab.ordenes_compra.approve); para EMITIR y CANCELAR, «Cambiar
// estado» de Contabilidad; y para todo cambio de estado, además «Editar» de Contabilidad (la política de UPDATE). Los
// genéricos «Autorizar / Denegar» y «Cambiar estado» de Contabilidad ya no conceden aprobar ni devolver.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { LLAVES_ACCION_COMPRAS } from '../../../../lib/platformPermissions'
import { GENERICOS_APROBAR, VER_Y_EDITAR, montarConSesion } from '../../../../test/sesionPermisos'

const h = vi.hoisted(() => ({ update: vi.fn(), prompt: vi.fn(), notify: vi.fn(), confirm: vi.fn() }))

vi.mock('../../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../../../domain/cxp/queries', () => ({ useProveedoresQuery: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../../domain/proveedores/queries', () => ({ useAsignacionesQuery: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../../domain/compras/queries', () => ({ useInsumosAlmacenQuery: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../../domain/compras/mutations', () => ({ crearOrdenTransaccional: vi.fn() }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: vi.fn(), updateCondominioRowAfectando: h.update, deleteCondominioRowAfectando: vi.fn(),
}))
vi.mock('../../../compras/SeguimientoOrdenModal', () => ({ SeguimientoOrdenModal: () => null }))
vi.mock('../../../proveedores/ContratoSeguimientoModal', () => ({ ContratoSeguimientoModal: () => null }))
vi.mock('../../../proveedores/ContratoSelector', () => ({ ContratoSelector: () => null }))
vi.mock('../../../../domain/proveedores/contratosCompras', async (orig) => ({
  ...(await orig<typeof import('../../../../domain/proveedores/contratosCompras')>()),
  useExcepcionContratoMutation: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: h.prompt }))
vi.mock('../../../shared/Dialog', () => ({ confirm: h.confirm, notify: h.notify }))

import OrdenesCompraTab from '../OrdenesCompraTab'

const K = LLAVES_ACCION_COMPRAS
const OTRAS = Object.values(K).filter((k) => k !== K.aprobarOrdenCompra)

const orden = (estado: string) => ({
  id: 'o1', company_id: 'c1', project_id: 'p1', correlativo: 1, numero: 'OC-000001', proveedor_id: null, proveedor_nombre: 'Prov',
  concepto: 'Compra X', monto_estimado: null, estado, contrato_id: null, created_at: '2026-10-02T00:00:00Z',
})

function montar(estado: string, permisos: readonly string[], role = 'operator') {
  const r = montarConSesion(
    <OrdenesCompraTab ordenes={[orden(estado)] as never} proyectoId="p1" companyId="c1" moneda="GTQ" canCreate canEdit onRefresh={vi.fn()} proveedores={[]} />,
    { permisos, role },
  )
  fireEvent.click(screen.getByText('Compra X'))     // expande la tarjeta
  return r
}

beforeEach(() => {
  h.update.mockResolvedValue({ error: null })
  h.confirm.mockResolvedValue({ isConfirmed: true })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Operaciones › Órdenes compra: cada paso se ofrece según SU llave', () => {
  it('con la llave de aprobar órdenes y «Editar» se ofrece aprobar, y el clic aprueba esa orden', async () => {
    montar('borrador', [...VER_Y_EDITAR, K.aprobarOrdenCompra])
    fireEvent.click(screen.getByText(/Aprobar/))
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('ordenes_compra', 'o1', { estado: 'aprobada' }))
  })

  it('con la llave pero SIN «Editar» de Contabilidad no se ofrece aprobar (el UPDATE no afectaría ninguna fila)', () => {
    montar('borrador', ['platform.contabilidad.view', K.aprobarOrdenCompra])
    expect(screen.queryByText(/Aprobar/)).toBeNull()
  })

  it('«Autorizar / Denegar» y «Cambiar estado» genéricos + las otras cinco llaves, SIN la de la orden: no se aprueba ni se devuelve', () => {
    montar('borrador', [...VER_Y_EDITAR, ...GENERICOS_APROBAR, ...OTRAS])
    expect(screen.queryByText(/Aprobar/)).toBeNull()
    cleanup()
    montar('aprobada', [...VER_Y_EDITAR, ...GENERICOS_APROBAR, ...OTRAS])
    expect(screen.queryByText(/Devolver a borrador/)).toBeNull()
    // …pero emitir y cancelar siguen con «Cambiar estado»
    expect(screen.getByText(/Emitir OC/)).toBeTruthy()
    expect(screen.getByText(/Cancelar OC/)).toBeTruthy()
  })

  it('la llave de aprobar órdenes SOLA ofrece devolver a borrador, pero no emitir ni cancelar', () => {
    montar('aprobada', [...VER_Y_EDITAR, K.aprobarOrdenCompra])
    expect(screen.getByText(/Devolver a borrador/)).toBeTruthy()
    expect(screen.queryByText(/Emitir OC/)).toBeNull()
    expect(screen.queryByText(/Cancelar OC/)).toBeNull()
  })

  it('«Cambiar estado» + «Editar» ofrece emitir y cancelar, no aprobar', () => {
    montar('borrador', [...VER_Y_EDITAR, 'platform.contabilidad.change_status'])
    expect(screen.queryByText(/Aprobar/)).toBeNull()
    expect(screen.getByText(/Cancelar OC/)).toBeTruthy()
  })

  it.each(['admin', 'company_owner', 'super_admin', 'superadmin'])('%s (exento) ve aprobar, devolver, emitir y cancelar sin llaves propias', (rol) => {
    montar('borrador', [], rol)
    expect(screen.getByText(/Aprobar/)).toBeTruthy()
    expect(screen.getByText(/Cancelar OC/)).toBeTruthy()
    cleanup()
    montar('aprobada', [], rol)
    expect(screen.getByText(/Devolver a borrador/)).toBeTruthy()
    expect(screen.getByText(/Emitir OC/)).toBeTruthy()
  })
})
