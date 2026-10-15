// Cierre técnico — Operaciones crea la orden con la MISMA operación transaccional que Contabilidad
// (`compras_orden_crear`): cabecera y renglones juntos, con una clave de idempotencia por apertura del
// formulario. Un doble clic o un reintento no duplica; si falla, no queda nada y el reintento sirve.
// Editar un borrador sigue siendo una actualización de la cabecera.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const PROV = '11111111-1111-4111-8111-111111111111'
const h = vi.hoisted(() => ({
  crear: vi.fn(),
  update: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../../../domain/cxp/queries', () => ({
  useProveedoresQuery: () => ({ data: [{ id: PROV, nombre: 'Proveedor ZZ', estado: 'autorizado', alcance: 'empresa' }], isLoading: false }),
}))
vi.mock('../../../../domain/proveedores/queries', () => ({ useAsignacionesQuery: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../../domain/compras/queries', () => ({
  useInsumosAlmacenQuery: () => ({ data: [], isLoading: false }),
}))
vi.mock('../../../../domain/compras/mutations', () => ({ crearOrdenTransaccional: h.crear }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: vi.fn(() => { throw new Error('Operaciones ya no inserta la cabecera por separado') }),
  updateCondominioRowAfectando: h.update,
  deleteCondominioRowAfectando: vi.fn(),
}))
vi.mock('../../../proveedores/ProveedorSelector', () => ({
  ProveedorSelector: ({ onChange }: { onChange: (id: string | null, p?: { nombre: string }) => void }) => (
    <button type="button" onClick={() => onChange(PROV, { nombre: 'Proveedor ZZ' })}>Elegir proveedor</button>
  ),
}))
vi.mock('../../../proveedores/ContratoSelector', () => ({ ContratoSelector: () => null }))
vi.mock('../../../proveedores/SugerenciaCuentaLinea', () => ({ SugerenciaCuentaLinea: () => null }))
vi.mock('../../../compras/SeguimientoOrdenModal', () => ({ SeguimientoOrdenModal: () => null }))
vi.mock('../../../compras/SeguimientoComprasPanel', () => ({ SeguimientoComprasPanel: () => null }))
vi.mock('../../../compras/ImportarLineasOrdenModal', () => ({ ImportarLineasOrdenModal: () => null }))
vi.mock('../../../proveedores/ContratoSeguimientoModal', () => ({ ContratoSeguimientoModal: () => null }))
vi.mock('../../../proveedores/permisos', () => ({ usePermisosProveedor: () => ({ cambiarEstado: true, puedeCambiarEstadoPaso: true, puedeAprobarOrdenCompra: true }) }))
vi.mock('../../../../domain/proveedores/contratosCompras', async (orig) => ({
  ...(await orig<typeof import('../../../../domain/proveedores/contratosCompras')>()),
  useExcepcionContratoMutation: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: vi.fn() }))
vi.mock('../../../shared/Dialog', () => ({ confirm: vi.fn(), notify: h.notify }))

import OrdenesCompraTab from '../OrdenesCompraTab'

const montar = (ordenes: never[] = [], onRefresh = vi.fn()) =>
  render(<OrdenesCompraTab ordenes={ordenes} proyectoId="p1" companyId="c1" moneda="GTQ" canCreate canEdit onRefresh={onRefresh} proveedores={[]} />)

function abrirYLlenar(concepto = 'Mantenimiento de bombas') {
  fireEvent.click(screen.getByRole('button', { name: '+ Nueva OC' }))
  fireEvent.click(screen.getByRole('button', { name: 'Elegir proveedor' }))
  fireEvent.change(screen.getByPlaceholderText('Descripción breve de la compra'), { target: { value: concepto } })
}

beforeEach(() => { h.crear.mockResolvedValue({ orden: { id: 'o1' }, lineas: [], reutilizada: false }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Operaciones · Nueva OC por la operación transaccional', () => {
  it('guarda cabecera y renglones en UNA llamada, con una clave de idempotencia', async () => {
    const onRefresh = vi.fn()
    montar([], onRefresh)
    abrirYLlenar()
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar renglón' }))
    fireEvent.change(screen.getByLabelText('Descripción del renglón 1'), { target: { value: 'Rodamientos' } })
    fireEvent.change(screen.getByLabelText('Cantidad del renglón 1'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Precio del renglón 1'), { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar como borrador' }))
    await waitFor(() => expect(h.crear).toHaveBeenCalledTimes(1))
    const [empresa, proyecto, datos] = h.crear.mock.calls[0]
    expect(empresa).toBe('c1')
    expect(proyecto).toBe('p1')
    expect(datos).toMatchObject({ proveedor_id: PROV, concepto: 'Mantenimiento de bombas' })
    expect(datos.clave_idempotencia).toMatch(/.{8,}/)
    expect(datos.lineas).toHaveLength(1)
    expect(datos.lineas[0]).toMatchObject({ descripcion: 'Rodamientos', cantidad: 4, precio_unitario: 25, destino_tipo: 'gasto', cuenta_id: null, suministro_id: null })
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })

  it('solo la cabecera (sin renglones) también va por la operación, con la lista vacía', async () => {
    montar()
    abrirYLlenar('Orden sin renglones')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar como borrador' }))
    await waitFor(() => expect(h.crear).toHaveBeenCalledTimes(1))
    expect(h.crear.mock.calls[0][2].lineas).toEqual([])
  })

  it('un doble clic NO duplica: una sola llamada', async () => {
    let resolver: (v: unknown) => void = () => {}
    h.crear.mockReturnValue(new Promise((r) => { resolver = r }))
    montar()
    abrirYLlenar()
    const guardar = screen.getByRole('button', { name: 'Guardar como borrador' })
    fireEvent.click(guardar)
    fireEvent.click(guardar)
    expect(h.crear).toHaveBeenCalledTimes(1)
    resolver({ orden: { id: 'o1' }, lineas: [], reutilizada: false })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Guardar como borrador' })).toBeNull())
  })

  it('si falla, avisa y el reintento usa LA MISMA clave (no queda nada creado, así que sirve)', async () => {
    h.crear.mockRejectedValueOnce(new Error('COMPRAS_LINEA_INSUMO_ALCANCE: el insumo no es del proyecto')).mockResolvedValueOnce({ orden: { id: 'o1' }, lineas: [], reutilizada: false })
    montar()
    abrirYLlenar()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar como borrador' }))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: expect.stringMatching(/INSUMO_ALCANCE/) })))
    // el formulario sigue abierto para corregir y reintentar
    fireEvent.click(screen.getByRole('button', { name: 'Guardar como borrador' }))
    await waitFor(() => expect(h.crear).toHaveBeenCalledTimes(2))
    expect(h.crear.mock.calls[1][2].clave_idempotencia).toBe(h.crear.mock.calls[0][2].clave_idempotencia)
  })

  it('otra orden (se vuelve a abrir el formulario) lleva una clave DISTINTA', async () => {
    montar()
    abrirYLlenar('Primera')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar como borrador' }))
    await waitFor(() => expect(h.crear).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Guardar como borrador' })).toBeNull())
    abrirYLlenar('Segunda')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar como borrador' }))
    await waitFor(() => expect(h.crear).toHaveBeenCalledTimes(2))
    expect(h.crear.mock.calls[1][2].clave_idempotencia).not.toBe(h.crear.mock.calls[0][2].clave_idempotencia)
  })

  it('la clave repetida con otro contenido se explica con un mensaje claro', async () => {
    h.crear.mockRejectedValueOnce(new Error('COMPRAS_ORDEN_CLAVE_CONFLICTO: la clave de idempotencia ya se usó…'))
    montar()
    abrirYLlenar()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar como borrador' }))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringMatching(/ya se guardó/) })))
  })

  it('un renglón de inventario sin insumo no se envía', async () => {
    montar()
    abrirYLlenar()
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar renglón' }))
    fireEvent.change(screen.getByLabelText('Descripción del renglón 1'), { target: { value: 'Cloro' } })
    fireEvent.change(screen.getByLabelText('Destino del renglón 1'), { target: { value: 'inventario' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar como borrador' }))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning', text: expect.stringMatching(/insumo del almacén/) })))
    expect(h.crear).not.toHaveBeenCalled()
  })

  it('sin proveedor o sin concepto no se llama al servidor', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva OC' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar como borrador' }))
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Campos requeridos' }))
    expect(h.crear).not.toHaveBeenCalled()
  })

  it('editar un borrador sigue siendo una actualización de la cabecera (no crea otra orden)', async () => {
    h.update.mockResolvedValue({ error: null })
    const borrador = { id: 'o9', company_id: 'c1', project_id: 'p1', correlativo: 9, numero: null, proveedor_id: PROV, proveedor_nombre: 'Proveedor ZZ', concepto: 'Borrador a editar', monto_estimado: null, estado: 'borrador', created_at: '2026-10-02T00:00:00Z' }
    montar([borrador] as never[])
    fireEvent.click(screen.getByText('Borrador a editar'))
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    fireEvent.change(screen.getByPlaceholderText('Descripción breve de la compra'), { target: { value: 'Borrador corregido' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar como borrador' }))
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('ordenes_compra', 'o9', expect.objectContaining({ concepto: 'Borrador corregido' })))
    expect(h.crear).not.toHaveBeenCalled()
  })
})
