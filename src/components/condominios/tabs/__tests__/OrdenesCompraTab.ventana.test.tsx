// Órdenes de compra: la ficha de la orden abre en ventana emergente (EditModal real, pantalla completa en el
// teléfono) al pulsar su tarjeta; antes se desplegaba en acordeón dentro de la tarjeta. El formulario de nueva /
// editar también va en ventana (antes se desplegaba entre los KPIs y la lista). Los pasos del ciclo, Editar y
// Seguimiento van en el pie; devolver, cancelar, eliminar e importar renglones, en «Otras acciones».
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const PROV = '11111111-1111-4111-8111-111111111111'
const h = vi.hoisted(() => ({
  update: vi.fn(),
  borrar: vi.fn(),
  notify: vi.fn(),
  confirm: vi.fn(),
  prompt: vi.fn(),
  cambiarEstado: true,
  aprobarOrden: true,
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../../../domain/cxp/queries', () => ({
  useProveedoresQuery: () => ({ data: [{ id: PROV, nombre: 'Proveedor ZZ', estado: 'autorizado', alcance: 'empresa' }], isLoading: false }),
}))
vi.mock('../../../../domain/proveedores/queries', () => ({ useAsignacionesQuery: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../../domain/compras/queries', () => ({ useInsumosAlmacenQuery: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../../domain/compras/mutations', () => ({ crearOrdenTransaccional: vi.fn() }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: vi.fn(), updateCondominioRowAfectando: h.update, deleteCondominioRowAfectando: h.borrar,
}))
vi.mock('../../../proveedores/ProveedorSelector', () => ({
  ProveedorSelector: ({ onChange }: { onChange: (id: string | null, p?: { nombre: string }) => void }) => (
    <button type="button" onClick={() => onChange(PROV, { nombre: 'Proveedor ZZ' })}>Elegir proveedor</button>
  ),
}))
vi.mock('../../../proveedores/ContratoSelector', () => ({ ContratoSelector: () => null }))
vi.mock('../../../proveedores/SugerenciaCuentaLinea', () => ({ SugerenciaCuentaLinea: () => null }))
vi.mock('../../../compras/SeguimientoOrdenModal', () => ({ SeguimientoOrdenModal: () => <div data-testid="seguimiento-orden" /> }))
vi.mock('../../../compras/SeguimientoComprasPanel', () => ({ SeguimientoComprasPanel: () => null }))
vi.mock('../../../compras/ImportarLineasOrdenModal', () => ({ ImportarLineasOrdenModal: () => null }))
vi.mock('../../../proveedores/ContratoSeguimientoModal', () => ({ ContratoSeguimientoModal: () => null }))
vi.mock('../../../proveedores/permisos', () => ({
  usePermisosProveedor: () => ({ cambiarEstado: h.cambiarEstado, puedeCambiarEstadoPaso: h.cambiarEstado, puedeAprobarOrdenCompra: h.aprobarOrden }),
}))
vi.mock('../../../../domain/proveedores/contratosCompras', async (orig) => ({
  ...(await orig<typeof import('../../../../domain/proveedores/contratosCompras')>()),
  useExcepcionContratoMutation: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: h.prompt }))
vi.mock('../../../shared/Dialog', () => ({ confirm: h.confirm, notify: h.notify }))

import OrdenesCompraTab from '../OrdenesCompraTab'

const orden = (over: Record<string, unknown> = {}) => ({
  id: 'o1', company_id: 'c1', project_id: 'p1', correlativo: 1, numero: 'OC-000001', proveedor_id: PROV, proveedor_nombre: 'Proveedor ZZ',
  concepto: 'Mantenimiento de bombas', descripcion: 'Cambio de sellos', monto_estimado: 1500, fecha_entrega_esperada: '2026-11-20',
  notas: 'Coordinar con el guardia', estado: 'borrador', contrato_id: null, created_at: '2026-10-02T00:00:00Z', ...over,
})

function montar(ordenes: Record<string, unknown>[] = [orden()], p: { canCreate?: boolean; canEdit?: boolean } = {}) {
  return render(<OrdenesCompraTab ordenes={ordenes as never} proyectoId="p1" companyId="c1" moneda="GTQ"
    canCreate={p.canCreate ?? true} canEdit={p.canEdit ?? true} onRefresh={vi.fn()} proveedores={[]} />)
}
const abrir = () => fireEvent.click(screen.getByRole('button', { name: 'Mantenimiento de bombas' }))
const ficha = () => screen.getByRole('dialog', { name: 'Mantenimiento de bombas' })

beforeEach(() => { h.cambiarEstado = true; h.aprobarOrden = true; h.update.mockResolvedValue({ error: null }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Órdenes de compra · la ficha abre en ventana', () => {
  it('sin pulsar nada sólo hay lista; la tarjeta abre la ficha a pantalla completa en el teléfono con sus datos y acciones', () => {
    montar()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('Cambio de sellos')).toBeNull()
    abrir()
    const v = ficha()
    expect(v.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(v).getByText('OC-000001')).toBeTruthy()
    expect(within(v).getByText('· Proveedor ZZ')).toBeTruthy()
    expect(within(v).getByText('GTQ 1500,00')).toBeTruthy()
    expect(within(v).getByText('2026-11-20')).toBeTruthy()
    expect(within(v).getByText('Cambio de sellos')).toBeTruthy()
    expect(within(v).getByText(/Coordinar con el guardia/)).toBeTruthy()
    const pie = v.querySelector('.at-modal-footer') as HTMLElement
    expect(within(pie).getByRole('button', { name: 'Cerrar' })).toBeTruthy()
    expect(within(pie).getByRole('button', { name: 'Seguimiento' })).toBeTruthy()
    expect(within(pie).getByRole('button', { name: '✏️ Editar' })).toBeTruthy()
    expect(within(pie).getByRole('button', { name: '→ Aprobar' })).toBeTruthy()
    expect(within(v).getByText('Importar renglones')).toBeTruthy()
    expect(within(v).getByText('Cancelar OC')).toBeTruthy()
    // Con número ya no es un borrador nuevo: no se ofrece borrarlo (sePuedeEliminar), sólo cancelarlo.
    expect(within(v).queryByText('🗑 Eliminar')).toBeNull()
  })

  it('un borrador nuevo (sin número) sí ofrece Eliminar en la ficha', () => {
    montar([orden({ numero: null })])
    abrir()
    expect(within(ficha()).getByText('🗑 Eliminar')).toBeTruthy()
  })

  it('Cerrar y Escape cierran la ficha; Seguimiento se abre desde el pie', () => {
    montar()
    abrir()
    fireEvent.click(within(ficha()).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    abrir()
    fireEvent.click(within(ficha()).getByRole('button', { name: 'Seguimiento' }))
    expect(screen.getByTestId('seguimiento-orden')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('+ Nueva OC abre el formulario en ventana desde la lista; Editar lo apila encima de la ficha y Escape cierra sólo el formulario', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva OC' }))
    const nueva = screen.getByRole('dialog', { name: 'Nueva orden de compra' })
    expect(nueva.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(nueva).getByRole('button', { name: 'Guardar como borrador' })).toBeTruthy()
    fireEvent.click(within(nueva).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    abrir()
    fireEvent.click(within(ficha()).getByRole('button', { name: '✏️ Editar' }))
    const editar = screen.getByRole('dialog', { name: 'Editar orden' })
    expect((within(editar).getByPlaceholderText('Descripción breve de la compra') as HTMLInputElement).value).toBe('Mantenimiento de bombas')
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Editar orden' })).toBeNull()
    expect(ficha()).toBeTruthy()
  })

  it('la ficha sigue a la orden recargada: aprobada ya no ofrece Editar ni Eliminar, y sí Emitir y Devolver', () => {
    const { rerender } = montar()
    abrir()
    rerender(<OrdenesCompraTab ordenes={[orden({ estado: 'aprobada', aprobada_at: '2026-10-03T00:00:00Z' })] as never} proyectoId="p1" companyId="c1" moneda="GTQ"
      canCreate canEdit onRefresh={vi.fn()} proveedores={[]} />)
    const v = ficha()
    expect(within(v).queryByRole('button', { name: '✏️ Editar' })).toBeNull()
    expect(within(v).queryByText('🗑 Eliminar')).toBeNull()
    expect(within(v).getByRole('button', { name: '→ Emitir OC' })).toBeTruthy()
    expect(within(v).getByText('Devolver a borrador')).toBeTruthy()
  })

  it('sin permiso de edición el pie sólo lleva Cerrar y Seguimiento y no hay otras acciones', () => {
    montar([orden()], { canEdit: false, canCreate: false })
    abrir()
    const v = ficha()
    const pie = v.querySelector('.at-modal-footer') as HTMLElement
    expect(within(pie).getAllByRole('button').map(b => b.textContent)).toEqual(['Cerrar', 'Seguimiento'])
    expect(within(v).queryByText('Otras acciones')).toBeNull()
  })
})
