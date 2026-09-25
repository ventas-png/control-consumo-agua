// Cobros de cargos adicionales (20261004000000) en la pestaña de Condominios.
//
// Lo que se fija:
//   · un cargo por tipo NO se «marca pagado»: se le registra un cobro (el
//     estado lo deriva el servidor);
//   · un cargo del camino histórico conserva «✓ Pagado»;
//   · un cargo «pagado» sin cobro vinculado no ofrece cobros (no se inventan);
//   · la clave de idempotencia es la MISMA en el reintento de un envío fallido
//     y cambia sólo tras un alta confirmada;
//   · un excedente se advierte antes de enviar y, si el servidor lo deja
//     pendiente, se informa su motivo;
//   · anular un cobro pide motivo y lo manda al servidor.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CargoAdicionalUnidad, Unidad } from '../../../../types'

interface Llamada { fn: string; args: Record<string, unknown> }

const h = vi.hoisted(() => ({
  llamadas: [] as Llamada[],
  respuestas: {} as Record<string, (args: Record<string, unknown>) => { data: unknown; error: unknown }>,
  notify: vi.fn(),
  prompt: vi.fn(),
  update: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({
  warmUpSupabase: vi.fn(),
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => ({
      abortSignal: async () => {
        h.llamadas.push({ fn, args })
        const r = h.respuestas[fn]
        return r ? r(args) : { data: [], error: null }
      },
    }),
  },
}))
vi.mock('../../../shared/Dialog', () => ({
  notify: h.notify,
  confirm: vi.fn(async () => ({ isConfirmed: true })),
}))
vi.mock('../../../shared/PromptDialog', () => ({ openTextPrompt: h.prompt }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: h.update,
}))

import CargosAdicionalesTab from '../CargosAdicionalesTab'

const U1: Unidad = { id: 'u1', nombre: 'Apto 101' } as Unidad
function cargo(id: string, concepto: string, estado: CargoAdicionalUnidad['estado'] = 'pendiente', monto = 100): CargoAdicionalUnidad {
  return {
    id, company_id: 'c1', project_id: 'p1', unidad_id: 'u1', concepto, categoria: 'reparacion', monto,
    fecha_cargo: '2026-06-01', fecha_vencimiento: null, estado, referencia: null, observaciones: null,
    created_at: '2026-06-01T00:00:00Z',
  } as CargoAdicionalUnidad
}
function resumen(cargo_id: string, extra: Record<string, unknown> = {}) {
  return {
    cargo_id, por_tipo: true, devengo_estado: 'publicado', devengado: 100, aplicado: 0, en_proceso: 0,
    saldo: 100, cobros: 0, pagado_sin_cobro: false, ...extra,
  }
}

function montar(cargos: CargoAdicionalUnidad[], onRefresh = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <CargosAdicionalesTab cargos={cargos} unidades={[U1]} proyectoId="p1" companyId="c1" moneda="GTQ"
        canCreate canEdit onRefresh={onRefresh} />
    </QueryClientProvider>,
  )
  return onRefresh
}

const llamadasA = (fn: string) => h.llamadas.filter((l) => l.fn === fn)

beforeEach(() => {
  h.llamadas = []
  h.respuestas = {}
  h.notify.mockReset()
  h.prompt.mockReset()
  h.update.mockReset()
  h.update.mockResolvedValue({ error: null })
  vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: vi.fn()
    .mockReturnValueOnce('clave-1').mockReturnValueOnce('clave-2').mockReturnValue('clave-n') })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('CargosAdicionalesTab · cobros', () => {
  it('cargo por tipo: «Registrar cobro» en lugar de «✓ Pagado»; histórico conserva «✓ Pagado»', async () => {
    h.respuestas.conta_cargos_cobro_resumen = () => ({
      data: [resumen('ca-tipo'), resumen('ca-hist', { por_tipo: false, devengo_estado: null })], error: null,
    })
    montar([cargo('ca-tipo', 'Vidrio'), cargo('ca-hist', 'Antiguo')])
    await screen.findByRole('button', { name: 'Registrar cobro' })
    const filaTipo = screen.getByText('Vidrio').closest('div[style]')!.parentElement!.parentElement!
    expect(within(filaTipo).queryByRole('button', { name: '✓ Pagado' })).toBeNull()
    const filaHist = screen.getByText('Antiguo').closest('div[style]')!.parentElement!.parentElement!
    expect(within(filaHist).getByRole('button', { name: '✓ Pagado' })).toBeTruthy()
    expect(within(filaHist).queryByRole('button', { name: 'Registrar cobro' })).toBeNull()
  })

  it('«pagado» sin cobro vinculado: se informa y no ofrece cobros', async () => {
    h.respuestas.conta_cargos_cobro_resumen = () => ({
      data: [resumen('ca-pag', { pagado_sin_cobro: true })], error: null,
    })
    montar([cargo('ca-pag', 'Heredado', 'pagado')])
    // El filtro por defecto es «Pendiente»: se quita para ver el cargo pagado.
    fireEvent.change(screen.getByDisplayValue('Pendiente'), { target: { value: '' } })
    expect(await screen.findByText(/Pagado sin cobro vinculado/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /cobro/i })).toBeNull()
  })

  it('registrar: la clave se conserva en el reintento y se renueva tras el alta', async () => {
    h.respuestas.conta_cargos_cobro_resumen = () => ({ data: [resumen('ca1')], error: null })
    let intento = 0
    h.respuestas.conta_registrar_cobro_cargo = () => {
      intento += 1
      if (intento === 1) return { data: null, error: { message: 'Failed to fetch' } }
      return {
        data: [{ pago_id: 'clave-1', repetido: false, resultado: 'contabilizada', codigo: null, motivo: null,
          asiento_id: 'a1', asiento_numero: 12, estado_cargo: 'pendiente' }], error: null,
      }
    }
    const onRefresh = montar([cargo('ca1', 'Vidrio')])
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText('Importe (GTQ)'), { target: { value: '30' } })
    const enviar = within(dialogo).getByRole('button', { name: 'Registrar cobro' })

    await act(async () => { fireEvent.click(enviar) })
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' })))
    await act(async () => { fireEvent.click(enviar) })
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Cobro registrado' })))

    const regs = llamadasA('conta_registrar_cobro_cargo')
    expect(regs).toHaveLength(2)
    expect(regs.map((l) => l.args.p_pago_id)).toEqual(['clave-1', 'clave-1'])
    expect(regs[1].args).toMatchObject({ p_cargo_id: 'ca1', p_monto: 30, p_metodo: 'efectivo' })
    expect(onRefresh).toHaveBeenCalled()

    // Un alta NUEVA usa otra clave.
    await act(async () => { fireEvent.click(enviar) })
    await waitFor(() => expect(llamadasA('conta_registrar_cobro_cargo')).toHaveLength(3))
    expect(llamadasA('conta_registrar_cobro_cargo')[2].args.p_pago_id).toBe('clave-2')
  })

  it('excedente: se advierte antes de enviar y el pendiente del servidor se informa con su motivo', async () => {
    h.respuestas.conta_cargos_cobro_resumen = () => ({ data: [resumen('ca1', { aplicado: 80, saldo: 20 })], error: null })
    h.respuestas.conta_registrar_cobro_cargo = () => ({
      data: [{ pago_id: 'clave-1', repetido: false, resultado: 'pendiente', codigo: 'excede_saldo',
        motivo: 'El cobro (40) supera el saldo pendiente del cargo (20).', asiento_id: null, asiento_numero: null,
        estado_cargo: 'pendiente' }], error: null,
    })
    montar([cargo('ca1', 'Vidrio')])
    expect(await screen.findByText(/Cobrado GTQ 80 · Saldo GTQ 20/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText('Importe (GTQ)'), { target: { value: '40' } })
    expect(within(dialogo).getByText(/no se reparte a otros cargos ni se vuelve anticipo/)).toBeTruthy()
    await act(async () => { fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' })) })
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith({
      variant: 'warning',
      title: 'Cobro registrado, pendiente de contabilizar (Excede el saldo)',
      text: 'El cobro (40) supera el saldo pendiente del cargo (20).',
    }))
  })

  it('anular un cobro pide motivo y lo envía; el cobro anulado se muestra con su reverso', async () => {
    h.respuestas.conta_cargos_cobro_resumen = () => ({ data: [resumen('ca1', { aplicado: 30, saldo: 70, cobros: 2 })], error: null })
    h.respuestas.conta_cargo_cobros = () => ({
      data: [
        { pago_id: 'p-viejo', fecha: '2026-06-02', monto: 10, metodo: 'efectivo', referencia: null, estado: 'rechazado',
          anulacion_motivo: 'cheque devuelto', aplicado: 10, asiento_id: 'a0', asiento_numero: 5, asiento_estado: 'publicado',
          reverso_id: 'r0', reverso_numero: 6, reverso_fecha: '2026-06-02', codigo: null, motivo: null },
        { pago_id: 'p-vivo', fecha: '2026-06-05', monto: 30, metodo: 'transferencia', referencia: 'TRX-1', estado: 'verificado',
          anulacion_motivo: null, aplicado: 30, asiento_id: 'a1', asiento_numero: 7, asiento_estado: 'publicado',
          reverso_id: null, reverso_numero: null, reverso_fecha: null, codigo: null, motivo: null },
      ], error: null,
    })
    h.respuestas.conta_anular_cobro_cargo = () => ({
      data: [{ pago_id: 'p-vivo', resultado: 'anulado', asiento_id: 'a1', reverso_id: 'r1', reverso_numero: 8,
        estado_cargo: 'pendiente', cobros_pendientes: 0 }], error: null,
    })
    h.prompt.mockResolvedValue('  error de captura ')
    montar([cargo('ca1', 'Vidrio')])
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')
    expect(await within(dialogo).findByText(/Anulado: cheque devuelto · reverso #6/)).toBeTruthy()
    expect(within(dialogo).getByText('Póliza #7')).toBeTruthy()
    const anular = within(dialogo).getAllByRole('button', { name: 'Anular' })
    expect(anular).toHaveLength(1)
    await act(async () => { fireEvent.click(anular[0]) })
    await waitFor(() => expect(llamadasA('conta_anular_cobro_cargo')).toHaveLength(1))
    expect(llamadasA('conta_anular_cobro_cargo')[0].args).toEqual({ p_pago_id: 'p-vivo', p_motivo: 'error de captura' })
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'success', title: 'Cobro anulado', text: 'Reverso en la póliza #8. El cargo queda pendiente.',
    })))
  })

  it('anular el CARGO con cobros vivos muestra el rechazo del servidor', async () => {
    h.respuestas.conta_cargos_cobro_resumen = () => ({ data: [resumen('ca1', { aplicado: 30, saldo: 70, cobros: 1 })], error: null })
    h.update.mockResolvedValue({ error: { message: 'CARGO_CON_COBROS: el cargo tiene cobros vivos; anula cada cobro antes de anular el cargo.' } })
    montar([cargo('ca1', 'Vidrio')])
    await screen.findByRole('button', { name: 'Registrar cobro' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Anular' })) })
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'error', title: 'No se anuló el cargo',
    })))
  })
})
