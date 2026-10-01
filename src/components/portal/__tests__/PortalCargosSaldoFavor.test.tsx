// Portal: cargos en línea, saldo a favor y solicitudes (20261011000000).
// El servidor filtra por la sesión y decide todo; aquí se fija que:
//   · se muestra sólo lo de la unidad elegida;
//   · el saldo a favor se SOLICITA (portal_solicitar_aplicacion_saldo_favor),
//     nunca se aplica desde el portal (E4);
//   · pagar un cargo va por create-charge con cargo_adicional_id y la
//     acreditación la confirma el servidor (confirm-charge).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  cuenta: {
    saldos: [] as Array<Record<string, unknown>>,
    documentos: [] as Array<Record<string, unknown>>,
    solicitudes: [] as Array<Record<string, unknown>>,
    error: null as string | null,
  },
  solicitar: vi.fn(async (_i: Record<string, unknown>) => ({ estado: 'pendiente', repetida: false, error: null as string | null })),
  iniciar: vi.fn(async (_id: string, _m?: number) => ({ estado: 'aprobado', redirectUrl: null as string | null, paymentRequestId: 'pr-1', error: null as string | null })),
  confirmar: vi.fn(async (_id: string) => ({ estado: 'aprobado', liquidado: true, saldoRestante: 0, error: null })),
  cancelar: vi.fn(async (_id: string) => ({ error: null })),
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, db: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify }))
vi.mock('../../../domain/portal/queries', () => ({ fetchPortalCuentaContable: async () => h.cuenta }))
vi.mock('../../../domain/portal/mutations', () => ({
  solicitarAplicacionSaldoFavor: h.solicitar,
  iniciarPagoCargo: h.iniciar,
  confirmarPago: h.confirmar,
  cancelarSolicitudPortal: h.cancelar,
}))

import { PortalCargosSaldoFavor } from '../PortalCargosSaldoFavor'

const U1 = 'u-1'
const U2 = 'u-2'

beforeEach(() => {
  h.cuenta = {
    saldos: [
      { origen_id: 'o-1', project_id: 'p', unidad_id: U1, tipo: 'anticipo', moneda: 'GTQ', monto: 40, disponible: 40, creado_at: '2026-09-01T00:00:00Z' },
      { origen_id: 'o-2', project_id: 'p', unidad_id: U2, tipo: 'excedente', moneda: 'GTQ', monto: 9, disponible: 9, creado_at: '2026-09-01T00:00:00Z' },
    ],
    documentos: [
      { documento_tabla: 'cargos_adicionales_unidad', documento_id: 'ca-1', project_id: 'p', unidad_id: U1, concepto: 'Vidrio', fecha: '2026-09-02', estado: 'pendiente', moneda: 'GTQ', saldo: 30 },
      { documento_tabla: 'cargos_adicionales_unidad', documento_id: 'ca-2', project_id: 'p', unidad_id: U2, concepto: 'Otra unidad', fecha: '2026-09-02', estado: 'pendiente', moneda: 'GTQ', saldo: 12 },
    ],
    solicitudes: [],
    error: null,
  }
  h.solicitar.mockClear(); h.iniciar.mockClear(); h.confirmar.mockClear(); h.notify.mockClear(); h.cancelar.mockClear()
})
afterEach(cleanup)

describe('PortalCargosSaldoFavor', () => {
  it('muestra sólo lo de la unidad elegida', async () => {
    render(<PortalCargosSaldoFavor unidadId={U1} moneda="Q" />)
    expect(await screen.findByText('Vidrio')).toBeTruthy()
    expect(screen.queryByText('Otra unidad')).toBeNull()
    expect(screen.getByText('GTQ 40.00')).toBeTruthy()
    expect(screen.queryByText('GTQ 9.00')).toBeNull()
  })

  it('el saldo a favor se SOLICITA; no se aplica desde el portal (E4)', async () => {
    render(<PortalCargosSaldoFavor unidadId={U1} moneda="Q" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Solicitar aplicación' }))
    const dialogo = screen.getByRole('dialog', { name: 'Solicitar aplicación de saldo a favor' })
    // Por defecto propone el documento y el menor entre disponible y saldo.
    expect((dialogo.querySelector('select') as HTMLSelectElement).value).toBe('ca-1')
    expect((dialogo.querySelector('input') as HTMLInputElement).value).toBe('30.00')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' })) })
    expect(h.solicitar).toHaveBeenCalledTimes(1)
    expect(h.solicitar.mock.calls[0][0]).toMatchObject({
      origenId: 'o-1', documentoTabla: 'cargos_adicionales_unidad', documentoId: 'ca-1', importe: 30,
    })
    expect(typeof h.solicitar.mock.calls[0][0].clave).toBe('string')
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Solicitud enviada' })))
  })

  it('el rechazo del servidor se muestra y no se da por enviada', async () => {
    h.solicitar.mockResolvedValueOnce({ estado: null as unknown as string, repetida: false, error: 'AJUSTE_IMPORTE: el importe…' })
    render(<PortalCargosSaldoFavor unidadId={U1} moneda="Q" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Solicitar aplicación' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' })) })
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', title: 'No se envió la solicitud' }))
    expect(screen.getByRole('dialog', { name: 'Solicitar aplicación de saldo a favor' })).toBeTruthy()
  })

  it('pagar un cargo usa create-charge con el cargo y confirma DESDE EL SERVIDOR', async () => {
    render(<PortalCargosSaldoFavor unidadId={U1} moneda="Q" />)
    await screen.findByText('Vidrio')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '💳 Pagar' })) })
    expect(h.iniciar).toHaveBeenCalledWith('ca-1')
    expect(h.confirmar).toHaveBeenCalledWith('pr-1')
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Cargo pagado' }))
  })

  it('con checkout hospedado redirige y NO acredita en el navegador', async () => {
    h.iniciar.mockResolvedValueOnce({ estado: 'requiere_accion', redirectUrl: 'https://pay.test/x', paymentRequestId: 'pr-9', error: null })
    const asignar = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, set href(v: string) { asignar(v) }, origin: 'https://app.test' }, writable: true })
    render(<PortalCargosSaldoFavor unidadId={U1} moneda="Q" />)
    await screen.findByText('Vidrio')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '💳 Pagar' })) })
    expect(asignar).toHaveBeenCalledWith('https://pay.test/x')
    expect(h.confirmar).not.toHaveBeenCalled()
  })

  it('las solicitudes pendientes se pueden cancelar; las en revisión no', async () => {
    h.cuenta.solicitudes = [
      { solicitud_id: 's-1', tipo: 'aplicar_saldo_favor', documento_tabla: 'cargos_adicionales_unidad', documento_id: 'ca-1',
        saldo_origen_id: 'o-1', importe: 10, moneda: 'GTQ', estado: 'pendiente', motivo: 'm', motivo_revision: null,
        solicitado_at: '2026-09-02T00:00:00Z', revisado_at: null, ejecutado_at: null },
      { solicitud_id: 's-2', tipo: 'aplicar_saldo_favor', documento_tabla: 'cargos_adicionales_unidad', documento_id: 'ca-1',
        saldo_origen_id: 'o-1', importe: 5, moneda: 'GTQ', estado: 'en_revision', motivo: 'm', motivo_revision: null,
        solicitado_at: '2026-09-01T00:00:00Z', revisado_at: null, ejecutado_at: null },
    ]
    render(<PortalCargosSaldoFavor unidadId={U1} moneda="Q" />)
    const cancelar = await screen.findAllByRole('button', { name: 'Cancelar' })
    expect(cancelar).toHaveLength(1)
    await act(async () => { fireEvent.click(cancelar[0]) })
    expect(h.cancelar).toHaveBeenCalledWith('s-1')
  })
})
