// Tipos de cambio mensuales (20261008000000) — pruebas de la PANTALLA.
//
// La conversión, la ausencia de tasa, la inmutabilidad de lo publicado, los
// permisos y la auditoría los cubre supabase/tests/conta_tipo_cambio_mensual
// contra un PostgreSQL real. Aquí se fija:
//   · la dirección escrita: «1 USD = x GTQ» con la moneda de la EMPRESA;
//   · que se registra por MES y que una tasa existente se cambia (no se duplica)
//     avisando que lo publicado no cambia;
//   · validación de moneda, mes y precisión antes de llamar al servidor;
//   · que las tasas diarias se muestran sólo como historia.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const h = vi.hoisted(() => ({
  tasas: [] as Array<Record<string, unknown>>,
  guardar: vi.fn(async (_v: unknown) => undefined),
  notify: vi.fn(),
  permisos: { puedeCrear: true, puedeEditar: true },
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify }))
vi.mock('../../../domain/contabilidad/queries', () => ({
  useTiposCambioQuery: (companyId?: string) => ({
    data: companyId ? [{ id: 'd1', company_id: 'c1', moneda: 'USD', fecha: '2026-07-01', tasa: 7.1, created_at: '' }] : [],
  }),
}))
vi.mock('../../../domain/contabilidad/tiposCambio', async (orig) => ({
  ...(await orig<typeof import('../../../domain/contabilidad/tiposCambio')>()),
  useTiposCambioMensualQuery: () => ({ data: h.tasas, isError: false }),
  useMonedaEmpresaQuery: () => ({ data: 'GTQ' }),
  useHistorialTipoCambioQuery: () => ({ data: [] }),
  useGuardarTipoCambioMensualMutation: () => ({ mutateAsync: h.guardar, isPending: false }),
}))
vi.mock('../ui', async (orig) => ({
  ...(await orig<typeof import('../ui')>()),
  usePermisosContabilidad: () => h.permisos,
}))

import { TiposCambioMensualSection } from '../TiposCambioMensualSection'

function montar(monedaLedger = 'GTQ') {
  render(<TiposCambioMensualSection companyId="c1" monedaLedger={monedaLedger} />)
}
function llenar(moneda: string, mes: string, tasa: string) {
  fireEvent.change(screen.getByLabelText('Moneda de origen'), { target: { value: moneda } })
  fireEvent.change(screen.getByLabelText('Mes'), { target: { value: mes } })
  fireEvent.change(screen.getByLabelText('Tasa'), { target: { value: tasa } })
}

beforeEach(() => {
  h.tasas = [{ id: 't1', company_id: 'c1', moneda: 'USD', moneda_base: 'GTQ', periodo: '2026-08', tasa: 7.7,
    created_at: '2026-08-01T00:00:00Z', created_by: 'u', updated_at: '2026-08-01T00:00:00Z', updated_by: 'u' }]
  h.guardar.mockReset()
  h.notify.mockReset()
  h.permisos = { puedeCrear: true, puedeEditar: true }
})
afterEach(cleanup)

describe('TiposCambioMensualSection', () => {
  it('muestra la dirección explícita con la moneda de la empresa', () => {
    montar()
    const tabla = screen.getByRole('table', { name: 'Tasas mensuales' })
    expect(within(tabla).getByText('2026-08')).toBeTruthy()
    expect(within(tabla).getByText(/1 USD = 7\.700000 GTQ/)).toBeTruthy()
  })

  it('registra la tasa de un mes nuevo', async () => {
    montar()
    llenar('usd', '2026-09', '7.8')
    expect(screen.getByRole('button', { name: 'Registrar' })).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Registrar' })) })
    expect(h.guardar).toHaveBeenCalledWith({ moneda: 'USD', periodo: '2026-09', tasa: 7.8, id: null })
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'success', text: '1 USD = 7.800000 GTQ para 2026-09.',
    }))
  })

  it('una tasa existente se CAMBIA (no se duplica) y se avisa que lo publicado no cambia', async () => {
    montar()
    llenar('USD', '2026-08', '7.75')
    expect(screen.getByRole('note').textContent).toMatch(/ya tiene tasa para 2026-08/)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cambiar' })) })
    expect(h.guardar).toHaveBeenCalledWith({ moneda: 'USD', periodo: '2026-08', tasa: 7.75, id: 't1' })
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringMatching(/ya publicados conservan la tasa/),
    }))
  })

  it('valida antes de llamar: moneda base, precisión y mes', async () => {
    montar()
    llenar('GTQ', '2026-09', '1')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Registrar' })) })
    llenar('USD', '2026-09', '7.1234567')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Registrar' })) })
    expect(h.guardar).not.toHaveBeenCalled()
    expect(h.notify.mock.calls.map((c) => (c[0] as { text: string }).text)).toEqual([
      'GTQ es la moneda de la empresa; no lleva tasa.',
      'La tasa admite hasta 6 decimales',
    ])
  })

  it('sin permiso de editar no se cambia una tasa existente', () => {
    h.permisos = { puedeCrear: true, puedeEditar: false }
    montar()
    llenar('USD', '2026-08', '7.75')
    expect((screen.getByRole('button', { name: 'Cambiar' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('las tasas diarias sólo como historia, y el ledger en otra moneda se explica', () => {
    montar('USD')
    expect(screen.getByText(/cruza por GTQ con las tasas del mismo mes/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tasas diarias anteriores' }))
    expect(screen.getByText(/Historia: estas tasas por día ya/).textContent).toMatch(/ya no se usan para convertir/)
    expect(screen.getByText(/1 USD = 7\.100000/)).toBeTruthy()
  })
})
