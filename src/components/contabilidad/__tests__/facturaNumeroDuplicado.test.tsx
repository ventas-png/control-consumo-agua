// Registrar factura: el rechazo por número duplicado se muestra el tiempo suficiente para leerlo.
//
// El servidor explica qué factura es la equivalente y cómo escribir el número (~270 caracteres). El aviso por omisión dura 3,5 s
// en una tarjeta de 380 px: no alcanza para leerlo y entender qué hacer. Este error dura bastante más (o hasta que se cierre).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))

const PROV = '11111111-1111-4111-8111-111111111111'
const PROY = '22222222-2222-4222-8222-222222222222'
const m = vi.hoisted(() => ({ crear: vi.fn(), notify: vi.fn() }))

// Texto final de COMPRAS_FACTURA_NUMERO_DUPLICADO (migración 20261027000900): con la factura equivalente y la forma de escribir el número
const DUPLICADO =
  'COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente («123», 10/10/2026 por 1.00, registrada). ' +
  'Si es la misma, no la registres otra vez. Si es otra, escribe su número tal como viene impreso, con su guion o separador entre serie y ' +
  'correlativo (p. ej. «A-123»); si ya lo escribiste así, pide a quien administra las facturas que corrija o anule primero la existente.'

vi.mock('../../../domain/cxp/queries', () => ({
  useProveedoresQuery: () => ({ data: [{ id: PROV, nombre: 'Proveedor ZZ', activo: true, dias_credito: 0, categoria_default: 'otros' }], isLoading: false }),
}))
vi.mock('../../../domain/cxp/mutations', () => ({ useCrearFacturaProveedorMutation: () => ({ mutateAsync: m.crear, isPending: false }) }))
vi.mock('../../../domain/compras/queries', () => ({
  useOrdenesCompraQuery: () => ({ data: [], isLoading: false }),
  useOrdenCompraLineasQuery: () => ({ data: [], isLoading: false }),
  useCuadreQuery: () => ({ data: [], isLoading: false }),
}))
vi.mock('../../../domain/compras/mutations', () => ({
  useAprobarFacturaConCuadreMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCrearContrasenaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../../shared/Dialog', () => ({ confirm: vi.fn(), notify: m.notify }))

import { FacturaFormModal } from '../CuentasPorPagarTab'

function llenarYRegistrar() {
  render(<FacturaFormModal companyId="c1" projectId={PROY} monedaBase="GTQ" onClose={vi.fn()} />)
  fireEvent.change(screen.getByLabelText(/Proveedor/), { target: { value: PROV } })
  fireEvent.change(screen.getByLabelText(/Concepto/), { target: { value: 'Papelería' } })
  fireEvent.change(screen.getByLabelText(/Monto total/), { target: { value: '100' } })
  fireEvent.click(screen.getByText('Registrar'))
}
const avisosDeError = () => m.notify.mock.calls.map(([o]) => o as { variant: string; text: string; duration?: number }).filter((o) => o.variant === 'error')

beforeEach(() => { m.crear.mockResolvedValue({ factura: { id: 'f1' }, lineas: [], reutilizada: false }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Registrar factura › número duplicado', () => {
  it('muestra el texto del servidor sin el código y lo deja en pantalla el tiempo suficiente para leerlo (≥ 10 s, o hasta cerrarlo)', async () => {
    m.crear.mockRejectedValueOnce(new Error(DUPLICADO))
    llenarYRegistrar()
    await waitFor(() => expect(avisosDeError()).toHaveLength(1))
    const [aviso] = avisosDeError()
    expect(aviso.text.startsWith('ya hay una factura de este proveedor con un número equivalente')).toBe(true)
    expect(aviso.text).not.toMatch(/COMPRAS_FACTURA_NUMERO_DUPLICADO/)
    expect(aviso.text.length).toBeGreaterThan(250)
    // duration 0 = no se cierra solo; si se cierra solo, que dure lo suficiente para un texto de este largo
    expect(aviso.duration === 0 || (aviso.duration ?? 0) >= 10_000, `duration = ${aviso.duration}`).toBe(true)
  })

  it('un registro correcto sigue usando el aviso corto de siempre (no se alarga lo que no hace falta)', async () => {
    llenarYRegistrar()
    await waitFor(() => expect(m.notify).toHaveBeenCalled())
    const exito = m.notify.mock.calls.map(([o]) => o as { variant: string; duration?: number }).find((o) => o.variant === 'success')
    expect(exito).toBeDefined()
    expect(exito!.duration).toBeUndefined()
  })
})
