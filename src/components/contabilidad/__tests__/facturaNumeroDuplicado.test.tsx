// Registrar factura: el rechazo por número duplicado se muestra el tiempo suficiente para leerlo.
//
// El servidor explica qué factura es la equivalente y cómo escribir el número (~270 caracteres). El aviso por omisión dura 3,5 s
// en una tarjeta de 380 px: no alcanza para leerlo y entender qué hacer. Este error dura bastante más (o hasta que se cierre).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { leerMigraciones } from '../../../test/sqlMigraciones'

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))

const PROV = '11111111-1111-4111-8111-111111111111'
const PROY = '22222222-2222-4222-8222-222222222222'
const m = vi.hoisted(() => ({ crear: vi.fn(), notify: vi.fn() }))

// Una de las salidas REALES del trigger `compras_tg_factura_numero_equivalente` (migración 20261027000900) cuando la persona ve la factura
// existente: escribió «123» y ya hay una «A-123» (el número nuevo trae MENOS separadores). Nombra la factura equivalente
// («número», fecha por importe, estado) y cierra con la sugerencia de ese caso. El aviso genérico (factura que la persona no ve) no nombra
// nada y termina en «pide a quien administra las facturas que corrija o anule primero la existente»; el servidor nunca mezcla las dos.
const SUGERENCIA =
  'Si es otra, escribe su número tal como viene impreso, con su guion o separador entre serie y correlativo (p. ej. «A-123»); ' +
  'si ya lo escribiste así, la existente se registró con más separadores: corrige o anula esa primero.'
const DUPLICADO =
  'COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente («A-123», 10/10/2026 por 100.00, registrada). ' +
  `Si es la misma, no la registres otra vez. ${SUGERENCIA}`

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
  it('el texto de prueba es una salida real del trigger: la cabecera y la sugerencia están, literales, en la migración 20261027000900', ({ skip }) => {
    const migracion = leerMigraciones().find((x) => x.nombre.startsWith('20261027000900'))
    // mientras la migración no esté en la carpeta que se lee, no hay contra qué contrastar (las pruebas de permisos también esperan esa migración)
    if (!migracion) skip('la migración 20261027000900 no está en la carpeta que se lee (MIGRACIONES_DIR / supabase/migrations)')
    expect(migracion!.sql).toContain(SUGERENCIA)
    expect(migracion!.sql).toContain('COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente («%», % por %, %). Si es la misma, no la registres otra vez. %')
  })

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
