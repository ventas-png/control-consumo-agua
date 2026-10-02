// Inventario desde la orden de compra — el renglón de inventario elige el INSUMO del almacén del
// proyecto, la unidad la fija el insumo y el insumo solo viaja con destino «inventario». Empresa,
// proyecto, unidad y destino los vuelve a validar el servidor
// (supabase/tests/compras_bloque_b/assert_inventario.sql).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))

const PROV = '11111111-1111-4111-8111-111111111111'
const PROY = '22222222-2222-4222-8222-222222222222'
const INS = '33333333-3333-4333-8333-333333333333'
const m = vi.hoisted(() => ({ crear: vi.fn(), insumos: [] as unknown[], notify: vi.fn() }))

vi.mock('../../../domain/compras/queries', () => ({
  useInsumosAlmacenQuery: (_c?: string, p?: string | null) => ({ data: p ? m.insumos : [], isLoading: false }),
}))
vi.mock('../../../domain/compras/mutations', () => ({
  useCrearOrdenCompraMutation: () => ({ mutateAsync: m.crear, isPending: false }),
}))
vi.mock('../../proveedores/SugerenciaCuentaLinea', () => ({ SugerenciaCuentaLinea: () => null }))
vi.mock('../../shared/Dialog', () => ({ confirm: vi.fn(), notify: m.notify }))

import { OrdenCompraModal } from '../ComprasTab'

const abrir = (projectId: string | null) =>
  render(<OrdenCompraModal companyId="c1" projectId={projectId} monedaBase="GTQ" proveedores={[{ id: PROV, nombre: 'Proveedor ZZ' }]} hayProveedores onClose={vi.fn()} />)

function llenarBase() {
  fireEvent.change(screen.getByText('Proveedor autorizado *').closest('label')!.querySelector('select')!, { target: { value: PROV } })
  fireEvent.change(screen.getByText('Concepto *').closest('label')!.querySelector('input')!, { target: { value: 'Compra de cloro' } })
  fireEvent.change(screen.getByLabelText('Precio del renglón 1'), { target: { value: '12.5' } })
  fireEvent.change(screen.getByLabelText('Cantidad del renglón 1'), { target: { value: '10' } })
}

beforeEach(() => {
  m.crear.mockResolvedValue({ id: 'o1' })
  m.insumos = [{ id: INS, nombre: 'Cloro', unidad_medida: 'litro', stock_actual: 40 }, { id: 'otro', nombre: 'Guantes', unidad_medida: 'caja', stock_actual: 3 }]
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Nueva orden: renglón de inventario', () => {
  it('en un proyecto ofrece «Inventario» como destino y el insumo del almacén con su unidad y stock', () => {
    abrir(PROY)
    const destino = screen.getByLabelText('Destino del renglón 1')
    expect(Array.from(destino.querySelectorAll('option')).map((o) => o.textContent)).toContain('Inventario')
    expect(screen.queryByLabelText('Insumo del renglón 1')).toBeNull()
    fireEvent.change(destino, { target: { value: 'inventario' } })
    const insumo = screen.getByLabelText('Insumo del renglón 1')
    expect(Array.from(insumo.querySelectorAll('option')).map((o) => o.textContent)).toContain('Cloro · litro · stock 40')
  })

  it('en la contabilidad de la EMPRESA no hay bodega: no se ofrece «Inventario»', () => {
    abrir(null)
    const opciones = Array.from(screen.getByLabelText('Destino del renglón 1').querySelectorAll('option')).map((o) => o.textContent)
    expect(opciones).not.toContain('Inventario')
    expect(opciones).toEqual(expect.arrayContaining(['Activo fijo', 'Servicio', 'Gasto']))
  })

  it('al elegir el insumo la unidad es la suya y no se edita', () => {
    abrir(PROY)
    fireEvent.change(screen.getByLabelText('Destino del renglón 1'), { target: { value: 'inventario' } })
    fireEvent.change(screen.getByLabelText('Insumo del renglón 1'), { target: { value: INS } })
    const unidad = screen.getByLabelText('Unidad del renglón 1') as HTMLInputElement
    expect(unidad.value).toBe('litro')
    expect(unidad.readOnly).toBe(true)
    expect((screen.getByLabelText('Descripción del renglón 1') as HTMLInputElement).value).toBe('Cloro')
  })

  it('guarda con el insumo elegido (suministro_id) y la unidad del insumo', async () => {
    abrir(PROY)
    llenarBase()
    fireEvent.change(screen.getByLabelText('Destino del renglón 1'), { target: { value: 'inventario' } })
    fireEvent.change(screen.getByLabelText('Insumo del renglón 1'), { target: { value: INS } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }))
    await waitFor(() => expect(m.crear).toHaveBeenCalled())
    const l = m.crear.mock.calls[0][0].lineas[0]
    expect(l).toMatchObject({ destino_tipo: 'inventario', suministro_id: INS, unidad: 'litro', cantidad: 10, precio_unitario: 12.5, cuenta_id: null })
  })

  it('un renglón de inventario SIN insumo no se guarda', async () => {
    abrir(PROY)
    llenarBase()
    fireEvent.change(screen.getByLabelText('Descripción del renglón 1'), { target: { value: 'Cloro' } })
    fireEvent.change(screen.getByLabelText('Destino del renglón 1'), { target: { value: 'inventario' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }))
    await waitFor(() => expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning', text: expect.stringMatching(/insumo del almacén/) })))
    expect(m.crear).not.toHaveBeenCalled()
  })

  it('cambiar el destino suelta el insumo: un gasto o un activo nunca viaja con insumo', async () => {
    abrir(PROY)
    llenarBase()
    fireEvent.change(screen.getByLabelText('Descripción del renglón 1'), { target: { value: 'Cloro' } })
    fireEvent.change(screen.getByLabelText('Destino del renglón 1'), { target: { value: 'inventario' } })
    fireEvent.change(screen.getByLabelText('Insumo del renglón 1'), { target: { value: INS } })
    fireEvent.change(screen.getByLabelText('Destino del renglón 1'), { target: { value: 'gasto' } })
    expect(screen.queryByLabelText('Insumo del renglón 1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }))
    await waitFor(() => expect(m.crear).toHaveBeenCalled())
    expect(m.crear.mock.calls[0][0].lineas[0].suministro_id).toBeNull()
  })
})
