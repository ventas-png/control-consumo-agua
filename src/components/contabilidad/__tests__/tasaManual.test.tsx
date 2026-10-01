// Póliza manual con líneas en otra moneda (decisión B1, 20261010000000).
//
// El servidor exige el motivo al publicar y deja la bitácora
// (supabase/tests/conta_tipo_cambio_mensual). Aquí se fija la PANTALLA:
//   · propone la tasa mensual del mes de la fecha y, sin escribir otra, la usa;
//   · escribir otra tasa (o no tener mensual) pide el motivo y no deja
//     publicar sin él;
//   · el motivo viaja al guardar.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CuentaContable } from '../../../types/contabilidad'
import { tasaMensualEntre } from '../../../domain/contabilidad/tiposCambio'

const h = vi.hoisted(() => ({
  tasas: [] as Array<Record<string, unknown>>,
  crear: vi.fn(async (_v: unknown) => ({ id: 'as1' })),
  publicar: vi.fn(async (_v: unknown) => undefined),
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify }))
vi.mock('../../../domain/contabilidad/queries', () => ({
  useCuentasQuery: () => ({
    data: [
      { id: '11111111-1111-4111-8111-111111111111', codigo: '1102', nombre: 'Banco USD', moneda: 'USD' },
      { id: '22222222-2222-4222-8222-222222222222', codigo: '4101', nombre: 'Ingreso', moneda: null },
    ].map((c) => ({
      ...c, company_id: 'c1', project_id: null, tipo: 'activo', naturaleza: 'deudora', padre_id: null,
      nivel: 4, es_detalle: true, activa: true, es_sistema: false, created_at: '', updated_at: '',
    }) as unknown as CuentaContable),
  }),
}))
vi.mock('../../../domain/contabilidad/tiposCambio', async (orig) => ({
  ...(await orig<typeof import('../../../domain/contabilidad/tiposCambio')>()),
  useTiposCambioMensualQuery: () => ({ data: h.tasas }),
  useMonedaEmpresaQuery: () => ({ data: 'GTQ' }),
}))
vi.mock('../../../domain/contabilidad/mutations', () => ({
  useCrearAsientoBorradorMutation: () => ({ mutateAsync: h.crear, isPending: false }),
  usePublicarAsientoMutation: () => ({ mutateAsync: h.publicar, isPending: false }),
}))

import { AsientoFormModal } from '../AsientoFormModal'

function armar(montoUsd: string, montoBase = '') {
  render(<AsientoFormModal companyId="c1" projectId={null} monedaBase="GTQ" onClose={() => {}} />)
  fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: '2026-09-15' } })
  fireEvent.change(screen.getByPlaceholderText('Descripción de la operación'), { target: { value: 'Depósito en USD' } })
  const selects = screen.getAllByRole('combobox').filter((s) => (s as HTMLSelectElement).options[0]?.text === 'Selecciona…')
  fireEvent.change(selects[0], { target: { value: '11111111-1111-4111-8111-111111111111' } })
  fireEvent.change(selects[1], { target: { value: '22222222-2222-4222-8222-222222222222' } })
  const montos = screen.getAllByRole('spinbutton').filter((i) => (i as HTMLInputElement).step === '0.01')
  fireEvent.change(montos[0], { target: { value: montoUsd } })
  if (montoBase) fireEvent.change(montos[1], { target: { value: montoBase } })
}

beforeEach(() => {
  h.tasas = [{ moneda: 'USD', moneda_base: 'GTQ', periodo: '2026-09', tasa: 7.8 }]
  h.crear.mockClear()
  h.publicar.mockClear()
  h.notify.mockReset()
})
afterEach(cleanup)

describe('tasaMensualEntre (misma regla que conta_tasa_entre)', () => {
  const tasas = [
    { moneda: 'USD', periodo: '2026-09', tasa: 7.8 },
    { moneda: 'EUR', periodo: '2026-09', tasa: 8.5 },
  ]
  it('directa hacia la moneda de la empresa, del MISMO mes', () => {
    expect(tasaMensualEntre(tasas, 'usd', 'GTQ', '2026-09', 'GTQ')).toBe(7.8)
    expect(tasaMensualEntre(tasas, 'USD', 'GTQ', '2026-08', 'GTQ')).toBeNull()
  })
  it('cruzada por el pivote, a 6 decimales', () => {
    expect(tasaMensualEntre(tasas, 'EUR', 'USD', '2026-09', 'GTQ')).toBe(Math.round((8.5 / 7.8) * 1e6) / 1e6)
  })
  it('misma moneda: 1', () => {
    expect(tasaMensualEntre([], 'GTQ', 'gtq', '2026-09', 'GTQ')).toBe(1)
  })
})

describe('AsientoFormModal · tasa manual (B1)', () => {
  it('propone la tasa mensual y, sin escribir otra, la usa sin pedir motivo', () => {
    armar('100')
    expect(screen.getByLabelText('Tipo de cambio de la línea 1').getAttribute('placeholder')).toBe('7.8')
    expect(screen.queryByLabelText('Motivo de la tasa distinta de la mensual')).toBeNull()
    expect(screen.getByText(/Debe .*780\.00/)).toBeTruthy()
  })

  it('otra tasa pide motivo y no publica sin él', () => {
    armar('100', '790')
    fireEvent.change(screen.getByLabelText('Tipo de cambio de la línea 1'), { target: { value: '7.9' } })
    expect(screen.getByLabelText('Motivo de la tasa distinta de la mensual')).toBeTruthy()
    fireEvent.click(screen.getByText('Guardar y publicar'))
    expect(h.crear).not.toHaveBeenCalled()
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Falta el motivo' }))
  })

  it('sin tasa mensual del mes también pide motivo; el motivo viaja al guardar', async () => {
    h.tasas = []
    armar('100', '775')
    fireEvent.change(screen.getByLabelText('Tipo de cambio de la línea 1'), { target: { value: '7.75' } })
    fireEvent.change(screen.getByLabelText('Motivo de la tasa distinta de la mensual'), {
      target: { value: 'Tasa pactada con el banco' },
    })
    fireEvent.click(screen.getByText('Guardar borrador'))
    await vi.waitFor(() => expect(h.crear).toHaveBeenCalled())
    expect(h.crear.mock.calls[0][0]).toMatchObject({
      tipo_cambio_motivo: 'Tasa pactada con el banco',
      lineas: expect.arrayContaining([expect.objectContaining({ moneda_origen: 'USD', tipo_cambio: 7.75, monto_origen: 100 })]),
    })
  })
})
