// Cierre técnico — Contabilidad crea la orden por la operación transaccional del servidor con una clave de
// idempotencia por apertura del formulario: un doble clic o un reintento no duplican; si falla, no queda nada y el
// reintento con los datos corregidos usa la MISMA clave. (La garantía real: supabase/tests/compras_cierre_tecnico.)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../../domain/proveedores/contratosCompras', async (orig) => ({
  ...(await orig<typeof import('../../../domain/proveedores/contratosCompras')>()),
  useContratosParaOrdenQuery: () => ({ data: [], isLoading: false }),
  useExcepcionContratoMutation: () => ({ mutateAsync: vi.fn() }),
}))

const PROV = '11111111-1111-4111-8111-111111111111'
const PROY = '22222222-2222-4222-8222-222222222222'
const m = vi.hoisted(() => ({ crear: vi.fn(), notify: vi.fn(), onClose: vi.fn() }))

vi.mock('../../../domain/compras/queries', () => ({ useInsumosAlmacenQuery: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../domain/compras/mutations', () => ({ useCrearOrdenCompraMutation: () => ({ mutateAsync: m.crear, isPending: false }) }))
vi.mock('../../proveedores/SugerenciaCuentaLinea', () => ({ SugerenciaCuentaLinea: () => null }))
vi.mock('../../shared/Dialog', () => ({ confirm: vi.fn(), notify: m.notify }))

import { OrdenCompraModal } from '../ComprasTab'

const abrir = () =>
  render(<OrdenCompraModal companyId="c1" projectId={PROY} monedaBase="GTQ" proveedores={[{ id: PROV, nombre: 'Proveedor ZZ' }]} hayProveedores onClose={m.onClose} />)

function llenar() {
  fireEvent.change(screen.getByText('Proveedor autorizado *').closest('label')!.querySelector('select')!, { target: { value: PROV } })
  fireEvent.change(screen.getByText('Concepto *').closest('label')!.querySelector('input')!, { target: { value: 'Compra de cloro' } })
  fireEvent.change(screen.getByLabelText('Descripción del renglón 1'), { target: { value: 'Cloro' } })
  fireEvent.change(screen.getByLabelText('Precio del renglón 1'), { target: { value: '12.5' } })
}

beforeEach(() => { m.crear.mockResolvedValue({ id: 'o1' }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Nueva orden (Contabilidad): clave de idempotencia', () => {
  it('manda una clave de idempotencia con los renglones, y el nombre del proveedor ya no viaja (lo pone el servidor)', async () => {
    abrir(); llenar()
    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }))
    await waitFor(() => expect(m.crear).toHaveBeenCalledTimes(1))
    const datos = m.crear.mock.calls[0][0]
    expect(datos.clave_idempotencia).toMatch(/.{8,}/)
    expect(datos.lineas).toHaveLength(1)
    expect(datos).not.toHaveProperty('proveedorNombre')
    await waitFor(() => expect(m.onClose).toHaveBeenCalled())
  })

  it('un doble clic NO duplica: una sola llamada', async () => {
    let resolver: (v: unknown) => void = () => {}
    m.crear.mockReturnValue(new Promise((r) => { resolver = r }))
    abrir(); llenar()
    const crear = screen.getByRole('button', { name: 'Crear borrador' })
    fireEvent.click(crear)
    fireEvent.click(crear)
    expect(m.crear).toHaveBeenCalledTimes(1)
    resolver({ id: 'o1' })
    await waitFor(() => expect(m.onClose).toHaveBeenCalledTimes(1))
  })

  it('si falla un renglón, avisa y el reintento corregido usa LA MISMA clave', async () => {
    m.crear.mockRejectedValueOnce(new Error('COMPRAS_LINEA_CUENTA_INVALIDA: la cuenta no es de la empresa')).mockResolvedValueOnce({ id: 'o1' })
    abrir(); llenar()
    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }))
    await waitFor(() => expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: expect.stringMatching(/CUENTA_INVALIDA/) })))
    expect(m.onClose).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Precio del renglón 1'), { target: { value: '13' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }))
    await waitFor(() => expect(m.crear).toHaveBeenCalledTimes(2))
    expect(m.crear.mock.calls[1][0].clave_idempotencia).toBe(m.crear.mock.calls[0][0].clave_idempotencia)
  })

  it('abrir otra vez el formulario (otra orden) genera otra clave', async () => {
    abrir(); llenar()
    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }))
    await waitFor(() => expect(m.crear).toHaveBeenCalledTimes(1))
    cleanup()
    abrir(); llenar()
    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }))
    await waitFor(() => expect(m.crear).toHaveBeenCalledTimes(2))
    expect(m.crear.mock.calls[1][0].clave_idempotencia).not.toBe(m.crear.mock.calls[0][0].clave_idempotencia)
  })

  it('la clave repetida con otro contenido se explica con un mensaje claro', async () => {
    m.crear.mockRejectedValueOnce(new Error('COMPRAS_ORDEN_CLAVE_CONFLICTO: la clave de idempotencia ya se usó…'))
    abrir(); llenar()
    fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }))
    await waitFor(() => expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringMatching(/ya se guardó/) })))
  })
})
