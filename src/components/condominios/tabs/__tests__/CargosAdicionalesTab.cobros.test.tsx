// Cobros de cargos adicionales (20261004000000) en la pestaña de Condominios.
//
// Lo que se fija:
//   · un cargo por tipo NO se «marca pagado»: se le registra un cobro (el
//     estado lo deriva el servidor);
//   · un cargo del camino histórico conserva «✓ Pagado»;
//   · un cargo «pagado» sin cobro vinculado no ofrece cobros (no se inventan);
//   · la clave de idempotencia es la MISMA en el reintento de un envío fallido
//     y cambia sólo tras un alta confirmada o por decisión explícita;
//   · una respuesta perdida NO se informa como «no se registró»: el resultado
//     es incierto, la clave y los datos se conservan (también al cerrar y
//     reabrir) y, si el cobro aparece en la lista, se reconoce como registrado;
//   · reintentar con la misma clave y OTROS datos (fecha, referencia) muestra
//     el rechazo del servidor, nunca un éxito;
//   · un cargo que no concuerda con su devengo no ofrece cobros y dice por qué;
//   · el envío se guarda ANTES de la petición: cerrar, reabrir o recargar con
//     la respuesta en vuelo recupera la misma clave (un solo cobro), y una
//     respuesta tardía sólo limpia su propio envío;
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
  sessionStorage.clear()
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
    // Sin respuesta: incierto, no «no se registró».
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'warning', title: 'No se pudo confirmar el cobro',
    })))
    expect(h.notify).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'No se registró el cobro' }))
    expect(within(dialogo).getByText(/Cobro sin confirmar/)).toBeTruthy()
    await act(async () => { fireEvent.click(enviar) })
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Cobro registrado' })))

    const regs = llamadasA('conta_registrar_cobro_cargo')
    expect(regs).toHaveLength(2)
    expect(regs.map((l) => l.args.p_pago_id)).toEqual(['clave-1', 'clave-1'])
    expect(regs[1].args).toMatchObject({ p_cargo_id: 'ca1', p_monto: 30, p_metodo: 'efectivo' })
    expect(onRefresh).toHaveBeenCalled()
    expect(within(dialogo).queryByText(/Cobro sin confirmar/)).toBeNull()
    expect(sessionStorage.length).toBe(0)

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

  it('respuesta perdida y reintento con OTRA FECHA: el servidor la rechaza y no se informa éxito', async () => {
    h.respuestas.conta_cargos_cobro_resumen = () => ({ data: [resumen('ca1')], error: null })
    let intento = 0
    h.respuestas.conta_registrar_cobro_cargo = () => {
      intento += 1
      if (intento === 1) return { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } }
      if (intento === 2) {
        return { data: null, error: { code: '23505', message: 'COBRO_CARGO_CLAVE_REUSADA: esa clave ya identifica un cobro de este cargo registrado con otros datos (difiere: fecha). No se registró otro cobro ni se modificó el anterior.' } }
      }
      return {
        data: [{ pago_id: 'clave-2', repetido: false, resultado: 'contabilizada', codigo: null, motivo: null,
          asiento_id: 'a2', asiento_numero: 13, estado_cargo: 'pendiente' }], error: null,
      }
    }
    montar([cargo('ca1', 'Vidrio')])
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText('Importe (GTQ)'), { target: { value: '30' } })
    fireEvent.change(within(dialogo).getByLabelText('Fecha'), { target: { value: '2026-07-08' } })
    const enviar = within(dialogo).getByRole('button', { name: 'Registrar cobro' })
    await act(async () => { fireEvent.click(enviar) })
    await within(dialogo).findByText(/Cobro sin confirmar/)

    // Se cambia la fecha y se reintenta: misma clave, el servidor rechaza.
    fireEvent.change(within(dialogo).getByLabelText('Fecha'), { target: { value: '2026-07-09' } })
    await act(async () => { fireEvent.click(enviar) })
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'error', title: 'No se registró este cobro', text: expect.stringContaining('difiere: fecha'),
    })))
    expect(h.notify).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }))
    const regs = llamadasA('conta_registrar_cobro_cargo')
    expect(regs.map((l) => [l.args.p_pago_id, l.args.p_fecha])).toEqual([['clave-1', '2026-07-08'], ['clave-1', '2026-07-09']])
    expect(within(dialogo).getByText(/El envío anterior ya quedó registrado con otros datos/)).toBeTruthy()
    // Sin una decisión explícita no se reenvía con otra clave.
    expect((within(dialogo).getByRole('button', { name: 'Registrar cobro' }) as HTMLButtonElement).disabled).toBe(true)

    await act(async () => { fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar como cobro nuevo' })) })
    await act(async () => { fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' })) })
    await waitFor(() => expect(llamadasA('conta_registrar_cobro_cargo')).toHaveLength(3))
    expect(llamadasA('conta_registrar_cobro_cargo')[2].args.p_pago_id).toBe('clave-2')
  })

  it('respuesta perdida, cerrar y reabrir: se conserva la clave; reintentar el envío anterior no duplica', async () => {
    h.respuestas.conta_cargos_cobro_resumen = () => ({ data: [resumen('ca1')], error: null })
    let intento = 0
    h.respuestas.conta_registrar_cobro_cargo = () => {
      intento += 1
      if (intento === 1) return { data: null, error: { message: 'AbortError: signal timed out', code: '' } }
      return {
        data: [{ pago_id: 'clave-1', repetido: true, resultado: 'contabilizada', codigo: null, motivo: null,
          asiento_id: 'a1', asiento_numero: 12, estado_cargo: 'pendiente' }], error: null,
      }
    }
    montar([cargo('ca1', 'Vidrio')])
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    let dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText('Importe (GTQ)'), { target: { value: '25' } })
    fireEvent.change(within(dialogo).getByLabelText('Referencia'), { target: { value: 'REC-9' } })
    fireEvent.change(within(dialogo).getByLabelText('Notas'), { target: { value: 'caja' } })
    await act(async () => { fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' })) })
    await within(dialogo).findByText(/Cobro sin confirmar/)

    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Registrar cobro' }))
    dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByText(/Cobro sin confirmar/)).toBeTruthy()
    expect((within(dialogo).getByLabelText('Referencia') as HTMLInputElement).value).toBe('REC-9')

    await act(async () => { fireEvent.click(within(dialogo).getByRole('button', { name: 'Reintentar el envío anterior' })) })
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'success', title: 'Cobro ya registrado',
    })))
    const regs = llamadasA('conta_registrar_cobro_cargo')
    expect(regs).toHaveLength(2)
    expect(regs[1].args).toEqual(regs[0].args)
    expect(regs[1].args).toMatchObject({ p_pago_id: 'clave-1', p_monto: 25, p_referencia: 'REC-9', p_notas: 'caja' })
    expect(sessionStorage.length).toBe(0)
  })

  it('respuesta perdida y reintento con OTRA REFERENCIA: rechazado sin éxito', async () => {
    h.respuestas.conta_cargos_cobro_resumen = () => ({ data: [resumen('ca1')], error: null })
    let intento = 0
    h.respuestas.conta_registrar_cobro_cargo = () => {
      intento += 1
      if (intento === 1) return { data: null, error: { message: 'Failed to fetch' } }
      return { data: null, error: { code: '23505', message: 'COBRO_CARGO_CLAVE_REUSADA: esa clave ya identifica un cobro de este cargo registrado con otros datos (difiere: referencia).' } }
    }
    montar([cargo('ca1', 'Vidrio')])
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText('Referencia'), { target: { value: 'A-1' } })
    await act(async () => { fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' })) })
    await within(dialogo).findByText(/Cobro sin confirmar/)
    fireEvent.change(within(dialogo).getByLabelText('Referencia'), { target: { value: 'A-2' } })
    await act(async () => { fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' })) })
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'error', title: 'No se registró este cobro', text: expect.stringContaining('difiere: referencia'),
    })))
    expect(h.notify).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }))
    expect(llamadasA('conta_registrar_cobro_cargo').map((l) => [l.args.p_pago_id, l.args.p_referencia]))
      .toEqual([['clave-1', 'A-1'], ['clave-1', 'A-2']])
  })

  it('respuesta perdida pero el cobro SÍ se registró: aparece en la lista y se reconoce', async () => {
    h.respuestas.conta_cargos_cobro_resumen = () => ({ data: [resumen('ca1')], error: null })
    h.respuestas.conta_registrar_cobro_cargo = () => ({ data: null, error: { message: 'Failed to fetch' } })
    let registrado = false
    h.respuestas.conta_cargo_cobros = () => ({
      data: registrado ? [{
        pago_id: 'clave-1', fecha: '2026-07-08', monto: 30, metodo: 'efectivo', referencia: null, estado: 'verificado',
        anulacion_motivo: null, aplicado: 30, asiento_id: 'a1', asiento_numero: 12, asiento_estado: 'publicado',
        reverso_id: null, reverso_numero: null, reverso_fecha: null, codigo: null, motivo: null,
      }] : [], error: null,
    })
    const onRefresh = montar([cargo('ca1', 'Vidrio')])
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText('Importe (GTQ)'), { target: { value: '30' } })
    registrado = true // el servidor sí lo guardó; sólo se perdió la respuesta
    await act(async () => { fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' })) })
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'info', title: 'El cobro anterior sí se registró',
    })))
    expect(within(dialogo).queryByText(/Cobro sin confirmar/)).toBeNull()
    expect(sessionStorage.length).toBe(0)
    expect(onRefresh).toHaveBeenCalled()
    // Un cobro siguiente es otro: clave nueva.
    await act(async () => { fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' })) })
    await waitFor(() => expect(llamadasA('conta_registrar_cobro_cargo')).toHaveLength(2))
    expect(llamadasA('conta_registrar_cobro_cargo')[1].args.p_pago_id).toBe('clave-2')
  })

  it('un rechazo con código del servidor sí es definitivo: «No se registró el cobro»', async () => {
    h.respuestas.conta_cargos_cobro_resumen = () => ({ data: [resumen('ca1')], error: null })
    h.respuestas.conta_registrar_cobro_cargo = () => ({
      data: null, error: { code: '22023', message: 'COBRO_CARGO_FECHA: la fecha del cobro es obligatoria y no puede ser futura.' },
    })
    montar([cargo('ca1', 'Vidrio')])
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')
    await act(async () => { fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' })) })
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'error', title: 'No se registró el cobro',
    })))
    expect(within(dialogo).queryByText(/Cobro sin confirmar/)).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })

  it('cargo modificado después de devengar: señala el motivo y no ofrece registrar cobros', async () => {
    const motivo = 'El importe del cargo (150.00 GTQ) no coincide con su devengo vigente (100.00 GTQ): el cargo se modificó después de contabilizarse y el devengo no se recalcula solo. No se aplican cobros ni se marca pagado. Restablece el importe del cargo a 100.00 GTQ, o anula el cargo y emite uno nuevo por el importe correcto.'
    h.respuestas.conta_cargos_cobro_resumen = () => ({
      data: [resumen('ca1', { cargo_monto: 150, moneda: 'GTQ', devengo_moneda: 'GTQ',
        coherencia_codigo: 'devengo_desalineado', coherencia_motivo: motivo })], error: null,
    })
    montar([cargo('ca1', 'Vidrio', 'pendiente', 150)])
    expect(await screen.findByText(/Importe distinto del devengo \(GTQ 100\): no admite cobros hasta corregirlo/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Registrar cobro' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cobros' }))
    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByRole('alert').textContent).toContain('Restablece el importe del cargo a 100.00 GTQ')
    expect(within(dialogo).queryByLabelText('Importe (GTQ)')).toBeNull()
    expect(llamadasA('conta_registrar_cobro_cargo')).toHaveLength(0)
  })

  // ── Respuesta DEMORADA: el envío se guarda antes de la petición ─────────
  // Servidor simulado: registra por clave (idempotente, como la RPC) y deja
  // la respuesta en espera hasta que la prueba la suelta.
  function servidorDemorado() {
    const cobros = new Map<string, Record<string, unknown>>()
    const enEspera: Array<() => void> = []
    let demorar = true
    h.respuestas.conta_registrar_cobro_cargo = (args) => {
      const clave = args.p_pago_id as string
      const repetido = cobros.has(clave)
      if (!repetido) cobros.set(clave, args)
      const respuesta = {
        data: [{ pago_id: clave, repetido, resultado: 'contabilizada', codigo: null, motivo: null,
          asiento_id: 'a-' + clave, asiento_numero: 40 + cobros.size, estado_cargo: 'pendiente' }], error: null,
      }
      if (!demorar) return respuesta
      return new Promise((resolver) => { enEspera.push(() => resolver(respuesta)) }) as never
    }
    return {
      cobros,
      soltarSiguiente: async () => { await act(async () => { enEspera.shift()!() }) },
      responderAlInstante: (v: boolean) => { demorar = !v },
      pendientes: () => enEspera.length,
    }
  }
  const guardado = (cargoId: string) => JSON.parse(sessionStorage.getItem(`cobro-cargo-incierto:${cargoId}`) ?? 'null')

  it('abono de 25 sobre 100 con respuesta demorada: cerrar y reabrir antes de resolver conserva la clave y hay un solo cobro', async () => {
    h.respuestas.conta_cargos_cobro_resumen = () => ({ data: [resumen('ca1')], error: null })
    const srv = servidorDemorado()
    montar([cargo('ca1', 'Vidrio')])
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    let dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText('Importe (GTQ)'), { target: { value: '25' } })
    await act(async () => { fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' })) })

    // La petición sigue en vuelo, pero el envío YA está guardado.
    expect(srv.pendientes()).toBe(1)
    expect(guardado('ca1')).toMatchObject({ clave: 'clave-1', datos: { monto: '25' } })

    // Se cierra y se reabre ANTES de que llegue la respuesta.
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cerrar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Registrar cobro' }))
    dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByText(/Cobro sin confirmar/)).toBeTruthy()
    expect((within(dialogo).getByLabelText('Importe (GTQ)') as HTMLInputElement).value).toBe('25')
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1) // no se generó otra clave

    // Reintento: misma clave; el servidor lo reconoce.
    srv.responderAlInstante(true)
    await act(async () => { fireEvent.click(within(dialogo).getByRole('button', { name: 'Reintentar el envío anterior' })) })
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'success', title: 'Cobro ya registrado',
    })))
    // Llega por fin la respuesta del primer envío.
    await srv.soltarSiguiente()

    const regs = llamadasA('conta_registrar_cobro_cargo')
    expect(regs.map((l) => l.args.p_pago_id)).toEqual(['clave-1', 'clave-1'])
    expect(regs[1].args).toEqual(regs[0].args)
    expect(srv.cobros.size).toBe(1)
    expect(guardado('ca1')).toBeNull()
  })

  it('recargar durante la petición: se recupera el envío; su respuesta tardía no borra un envío posterior', async () => {
    h.respuestas.conta_cargos_cobro_resumen = () => ({ data: [resumen('ca1')], error: null })
    const srv = servidorDemorado()
    montar([cargo('ca1', 'Vidrio')])
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    let dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText('Importe (GTQ)'), { target: { value: '25' } })
    await act(async () => { fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' })) })
    expect(srv.pendientes()).toBe(1)

    // «Recarga»: se desmonta todo (otra instancia, otra caché) y se vuelve.
    cleanup()
    montar([cargo('ca1', 'Vidrio')])
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByText(/Cobro sin confirmar/)).toBeTruthy()

    // El reintento confirma clave-1; el formulario pasa a clave-2.
    srv.responderAlInstante(true)
    await act(async () => { fireEvent.click(within(dialogo).getByRole('button', { name: 'Reintentar el envío anterior' })) })
    await waitFor(() => expect(guardado('ca1')).toBeNull())

    // Un cobro NUEVO (clave-2), también demorado.
    srv.responderAlInstante(false)
    fireEvent.change(within(dialogo).getByLabelText('Importe (GTQ)'), { target: { value: '10' } })
    await act(async () => { fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' })) })
    expect(guardado('ca1')).toMatchObject({ clave: 'clave-2', datos: { monto: '10' } })

    // Llega la respuesta TARDÍA del primer formulario (clave-1): no toca el de clave-2.
    await srv.soltarSiguiente()
    expect(guardado('ca1')).toMatchObject({ clave: 'clave-2' })

    // Y cuando se confirma clave-2, sí se limpia.
    await srv.soltarSiguiente()
    await waitFor(() => expect(guardado('ca1')).toBeNull())
    expect(llamadasA('conta_registrar_cobro_cargo').map((l) => l.args.p_pago_id)).toEqual(['clave-1', 'clave-1', 'clave-2'])
    expect(srv.cobros.size).toBe(2)
  })
})

describe('clasificarFalloRegistro', () => {
  it('sin código del servidor es incierto; con código, rechazo o clave reusada', async () => {
    const { clasificarFalloRegistro } = await import('../../../../domain/contabilidad/cobrosCargo')
    const { QueryError } = await import('../../../../domain/queryFetch')
    const qe = (message: string, code?: string) =>
      new QueryError(message, { message, code, details: '', hint: '' } as never)
    expect(clasificarFalloRegistro(qe('TypeError: Failed to fetch', '')).tipo).toBe('incierto')
    expect(clasificarFalloRegistro(qe('AbortError: signal timed out')).tipo).toBe('incierto')
    expect(clasificarFalloRegistro(qe('<html>502 Bad Gateway</html>', '502')).tipo).toBe('incierto')
    expect(clasificarFalloRegistro(new Error('El servidor no devolvió el resultado del cobro.')).tipo).toBe('incierto')
    expect(clasificarFalloRegistro(qe('COBRO_CARGO_CLAVE_REUSADA: …', '23505')).tipo).toBe('clave_reusada')
    expect(clasificarFalloRegistro(qe('COBRO_CARGO_DESALINEADO: …', '23514')).tipo).toBe('rechazado')
    expect(clasificarFalloRegistro(qe('JWT expired', 'PGRST301')).tipo).toBe('rechazado')
  })
})
