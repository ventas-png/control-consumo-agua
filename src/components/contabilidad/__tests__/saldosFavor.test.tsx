// Saldos a favor (20261007000000) — pruebas de la PANTALLA.
//
// Qué NO se prueba acá: disponible, saldo del documento, titular, moneda,
// reparto mora/principal, permisos, concurrencia ni aislamiento. Todo eso lo
// decide el servidor y lo cubre supabase/tests/conta_saldos_favor contra un
// PostgreSQL real, con sesiones simultáneas.
//
// Lo que sí es de la pantalla, y se fija:
//   · el sujeto del estado de cuenta viaja al servidor (cliente o unidad);
//   · origen, aplicado y disponible se muestran TAL CUAL llegan;
//   · aplicar exige elegir un documento del MISMO titular (la lista la da el
//     servidor), propone el menor entre disponible y deuda, y manda la clave;
//   · la clave se conserva en el reintento de una respuesta perdida y el
//     resultado se informa como INCIERTO, nunca como «no se aplicó»;
//   · un rechazo del servidor se explica con su motivo;
//   · revertir pide motivo; sin permiso de aplicar no hay botones;
//   · la cuenta de anticipos sin configurar se avisa, y los anticipos que
//     todavía no son saldo se listan aparte.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { UserSession } from '../../../types'

interface Llamada { fn: string; args: Record<string, unknown> }

const h = vi.hoisted(() => ({
  llamadas: [] as Llamada[],
  respuestas: {} as Record<string, (args: Record<string, unknown>) => { data: unknown; error: unknown }>,
  notify: vi.fn(),
  prompt: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({
  warmUpSupabase: vi.fn(),
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => ({
      abortSignal: async () => {
        h.llamadas.push({ fn, args })
        const r = h.respuestas[fn]
        return r ? r(args) : { data: null, error: null }
      },
    }),
  },
}))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify, confirm: vi.fn() }))
vi.mock('../../shared/PromptDialog', () => ({ openTextPrompt: h.prompt }))

import { SaldosFavorPanel } from '../SaldosFavorPanel'
import { SessionProvider } from '../../shared/SessionContext'
import { PermissionsProvider } from '../../shared/PermissionsContext'

function origen(over: Record<string, unknown> = {}) {
  return {
    origen_id: 'o-1', pago_id: 'pg-1', tipo: 'excedente', fecha: '2026-09-10', asiento_id: 'as-1', asiento_numero: 21,
    estado: 'vigente', metodo: 'efectivo', referencia: 'R-1', cobro_monto: 130, cobro_estado: 'verificado',
    cliente_id: 'cli-1', cliente_nombre: 'Cliente Uno', unidad_id: 'u-1', unidad_nombre: 'Apto 101', moneda: 'GTQ',
    monto: 30, aplicado: 10, disponible: 20, documento_tabla: 'cargos_adicionales_unidad', documento_id: 'ca-1',
    documento: 'Cargo Vidrio', ...over,
  }
}
function aplicacion(over: Record<string, unknown> = {}) {
  return {
    aplicacion_id: 'ap-1', origen_id: 'o-1', pago_id: 'pg-1', documento_tabla: 'cuotas_condominio', documento_id: 'q-1',
    documento: 'Cuota Mantenimiento 2026-09', cliente_id: 'cli-1', unidad_id: 'u-1', moneda: 'GTQ',
    monto: 10, monto_mora: 4, monto_principal: 6, fecha: '2026-09-12', asiento_id: 'as-2', asiento_numero: 22,
    notas: null, creada_at: '2026-09-12T10:00:00Z', creada_por: 'u1', vigente: true, revertida_at: null,
    revertida_por: null, motivo_reverso: null, reverso_id: null, reverso_numero: null, reverso_fecha: null, ...over,
  }
}
function saldos(over: Record<string, unknown> = {}) {
  return {
    project_id: 'p-1', origenes: [origen()], aplicaciones: [aplicacion()], anticipos_pendientes: [],
    disponible_por_moneda: [{ moneda: 'GTQ', disponible: 20 }],
    cuenta_anticipos: { cuenta_id: 'cta-ant', codigo: null, motivo: null }, puede_aplicar: true, ...over,
  }
}

function montar(opts: { rol?: string; sujeto?: { tipo: 'cliente' | 'unidad'; id: string } } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const session = { user_id: 'u1', company_id: 'c1', role: opts.rol ?? 'admin', permissions: new Set<string>() } as unknown as UserSession
  const onAbrirAsiento = vi.fn()
  render(
    <QueryClientProvider client={qc}>
      <SessionProvider value={session}>
        <PermissionsProvider>
          <SaldosFavorPanel companyId="c1" projectId="p-1" sujeto={opts.sujeto ?? { tipo: 'cliente', id: 'cli-1' }}
            unidades={[{ id: 'u-1', nombre: 'Apto 101' }]} clientes={[{ cliente_id: 'cli-1', cliente_nombre: 'Cliente Uno' }]}
            onAbrirAsiento={onAbrirAsiento} />
        </PermissionsProvider>
      </SessionProvider>
    </QueryClientProvider>,
  )
  return { onAbrirAsiento }
}

const llamadasA = (fn: string) => h.llamadas.filter((l) => l.fn === fn)

beforeEach(() => {
  h.llamadas = []
  h.respuestas = { conta_saldos_favor: () => ({ data: saldos(), error: null }) }
  h.notify.mockReset()
  h.prompt.mockReset()
  vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: vi.fn()
    .mockReturnValueOnce('k-1').mockReturnValueOnce('k-2').mockReturnValueOnce('k-3').mockReturnValue('k-n') })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('SaldosFavorPanel', () => {
  it('pide los saldos del sujeto y muestra origen, aplicado y disponible del servidor', async () => {
    montar({ sujeto: { tipo: 'unidad', id: 'u-1' } })
    const tabla = await screen.findByRole('table', { name: 'Orígenes de saldo a favor' })
    expect(llamadasA('conta_saldos_favor')[0].args).toEqual({ p_project_id: 'p-1', p_cliente_id: null, p_unidad_id: 'u-1' })
    const fila = within(tabla).getByText('Excedente de cobro').closest('tr')!
    expect(within(fila).getByText(/Cargo Vidrio · Cobro efectivo ref\. R-1/)).toBeTruthy()
    // Importe, aplicado y disponible: las tres columnas numéricas, tal cual.
    const celdas = [...fila.querySelectorAll('td')].map((td) => td.textContent ?? '')
    expect(celdas[3]).toMatch(/30\.00$/)
    expect(celdas[4]).toMatch(/10\.00$/)
    expect(celdas[5]).toMatch(/20\.00$/)
    // La aplicación, con su reparto mora/principal.
    const apl = screen.getByRole('table', { name: 'Aplicaciones de saldo a favor' })
    expect(within(apl).getByText('Cuota Mantenimiento 2026-09')).toBeTruthy()
    expect(within(apl).getByText(/Mora .*4\.00 · principal .*6\.00/)).toBeTruthy()
  })

  it('aplicar: documentos del mismo titular, propuesta del menor importe y la clave del formulario', async () => {
    h.respuestas.conta_saldo_favor_documentos = () => ({
      data: [
        { documento_tabla: 'cuotas_condominio', documento_id: 'q-1', concepto: 'Mantenimiento 2026-10', fecha: '2026-10-01',
          moneda: 'GTQ', saldo_mora: 5, saldo_principal: 100, saldo: 105 },
        { documento_tabla: 'cargos_adicionales_unidad', documento_id: 'ca-9', concepto: 'Portón', fecha: '2026-09-20',
          moneda: 'GTQ', saldo_mora: 0, saldo_principal: 8, saldo: 8 },
      ], error: null,
    })
    h.respuestas.conta_aplicar_saldo_favor = () => ({
      data: [{ aplicacion_id: 'k-2', repetido: false, asiento_id: 'as-9', asiento_numero: 30, monto: 8, monto_mora: 0,
        monto_principal: 8, disponible_restante: 12, saldo_documento: 0, estado_documento: 'pagado' }], error: null,
    })
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Aplicar' }))
    const form = await screen.findByRole('group', { name: 'Aplicar saldo a favor' })
    expect(llamadasA('conta_saldo_favor_documentos')[0].args).toEqual({ p_origen_id: 'o-1' })
    const select = await within(form).findByLabelText('Documento')
    fireEvent.change(select, { target: { value: 'ca-9' } })
    // Propuesta: min(disponible 20, deuda 8).
    expect((within(form).getByLabelText('Importe a aplicar') as HTMLInputElement).value).toBe('8')
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Aplicar' })) })
    await waitFor(() => expect(llamadasA('conta_aplicar_saldo_favor')).toHaveLength(1))
    expect(llamadasA('conta_aplicar_saldo_favor')[0].args).toEqual({
      p_origen_id: 'o-1', p_documento_tabla: 'cargos_adicionales_unidad', p_documento_id: 'ca-9',
      p_monto: 8, p_notas: null, p_aplicacion_id: 'k-2',
    })
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'success', title: 'Saldo aplicado', text: expect.stringMatching(/Póliza #30\. Queda disponible 12\.00/),
    })))
  })

  it('una respuesta perdida es INCIERTA y el reintento usa la MISMA clave', async () => {
    h.respuestas.conta_saldo_favor_documentos = () => ({
      data: [{ documento_tabla: 'cargos_adicionales_unidad', documento_id: 'ca-9', concepto: 'Portón', fecha: '2026-09-20',
        moneda: 'GTQ', saldo_mora: 0, saldo_principal: 8, saldo: 8 }], error: null,
    })
    let n = 0
    h.respuestas.conta_aplicar_saldo_favor = () => {
      n += 1
      if (n === 1) throw new TypeError('Failed to fetch')
      return { data: [{ aplicacion_id: 'k-2', repetido: true, asiento_id: 'as-9', asiento_numero: 30, monto: 8, monto_mora: 0,
        monto_principal: 8, disponible_restante: 12, saldo_documento: null, estado_documento: 'pagado' }], error: null }
    }
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Aplicar' }))
    const form = await screen.findByRole('group', { name: 'Aplicar saldo a favor' })
    fireEvent.change(await within(form).findByLabelText('Documento'), { target: { value: 'ca-9' } })
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Aplicar' })) })
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'warning', title: 'No se pudo confirmar la aplicación',
    })))
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Reintentar' })) })
    await waitFor(() => expect(llamadasA('conta_aplicar_saldo_favor')).toHaveLength(2))
    const claves = llamadasA('conta_aplicar_saldo_favor').map((l) => l.args.p_aplicacion_id)
    expect(claves[0]).toBe(claves[1])
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'success', title: 'La aplicación ya estaba registrada',
    })))
  })

  it('un rechazo del servidor se explica con su motivo', async () => {
    h.respuestas.conta_saldo_favor_documentos = () => ({
      data: [{ documento_tabla: 'cargos_adicionales_unidad', documento_id: 'ca-9', concepto: 'Portón', fecha: '2026-09-20',
        moneda: 'GTQ', saldo_mora: 0, saldo_principal: 8, saldo: 8 }], error: null,
    })
    h.respuestas.conta_aplicar_saldo_favor = () => ({
      data: null, error: { code: 'P0001', message: 'SALDO_FAVOR_INSUFICIENTE: el disponible de este saldo a favor es 5.00 GTQ; no alcanza para 8.' },
    })
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Aplicar' }))
    const form = await screen.findByRole('group', { name: 'Aplicar saldo a favor' })
    fireEvent.change(await within(form).findByLabelText('Documento'), { target: { value: 'ca-9' } })
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Aplicar' })) })
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith({
      variant: 'error', title: 'No se aplicó el saldo',
      text: 'Saldo insuficiente. el disponible de este saldo a favor es 5.00 GTQ; no alcanza para 8.',
    }))
  })

  it('revertir pide motivo y lo manda; sin motivo no se llama al servidor', async () => {
    h.respuestas.conta_revertir_aplicacion_saldo_favor = () => ({
      data: [{ aplicacion_id: 'ap-1', resultado: 'revertida', reverso_id: 'as-3', reverso_numero: 23,
        disponible_restante: 30, estado_documento: 'pendiente' }], error: null,
    })
    montar()
    const apl = await screen.findByRole('table', { name: 'Aplicaciones de saldo a favor' })
    h.prompt.mockResolvedValueOnce(null)
    await act(async () => { fireEvent.click(within(apl).getByRole('button', { name: 'Revertir' })) })
    expect(llamadasA('conta_revertir_aplicacion_saldo_favor')).toHaveLength(0)
    h.prompt.mockResolvedValueOnce('  se aplicó al documento equivocado ')
    await act(async () => { fireEvent.click(within(apl).getByRole('button', { name: 'Revertir' })) })
    await waitFor(() => expect(llamadasA('conta_revertir_aplicacion_saldo_favor')).toHaveLength(1))
    expect(llamadasA('conta_revertir_aplicacion_saldo_favor')[0].args).toEqual({
      p_aplicacion_id: 'ap-1', p_motivo: 'se aplicó al documento equivocado',
    })
  })

  it('una aplicación revertida muestra su motivo y su reverso, sin botón', async () => {
    h.respuestas.conta_saldos_favor = () => ({
      data: saldos({ aplicaciones: [aplicacion({ vigente: false, revertida_at: '2026-09-13T12:00:00Z',
        motivo_reverso: 'error de captura', reverso_id: 'as-3', reverso_numero: 23 })] }), error: null,
    })
    const { onAbrirAsiento } = montar()
    const apl = await screen.findByRole('table', { name: 'Aplicaciones de saldo a favor' })
    expect(within(apl).getByText('Revertida')).toBeTruthy()
    expect(within(apl).getByText(/error de captura/)).toBeTruthy()
    expect(within(apl).queryByRole('button', { name: 'Revertir' })).toBeNull()
    fireEvent.click(within(apl).getByRole('button', { name: 'Reverso #23' }))
    expect(onAbrirAsiento).toHaveBeenCalledWith('as-3')
  })

  it('sin permiso de aplicar (servidor) no hay botones de aplicar ni revertir', async () => {
    h.respuestas.conta_saldos_favor = () => ({ data: saldos({ puede_aplicar: false }), error: null })
    montar({ rol: 'viewer' })
    await screen.findByRole('table', { name: 'Orígenes de saldo a favor' })
    expect(screen.queryByRole('button', { name: 'Aplicar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Revertir' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Registrar anticipo' })).toBeNull()
  })

  it('cuenta de anticipos sin configurar y anticipos que todavía no son saldo', async () => {
    h.respuestas.conta_saldos_favor = () => ({
      data: saldos({
        origenes: [], aplicaciones: [], disponible_por_moneda: [],
        cuenta_anticipos: { cuenta_id: null, codigo: 'sin_cuenta', motivo: 'Falta la cuenta de anticipos de clientes.' },
        anticipos_pendientes: [{ pago_id: 'an-1', fecha: '2026-09-20', monto: 60, metodo: 'efectivo', referencia: null,
          estado: 'verificado', cliente_id: 'cli-1', cliente_nombre: 'Cliente Uno', unidad_id: 'u-1', unidad_nombre: 'Apto 101',
          codigo: 'sin_cuenta', motivo: 'El anticipo quedó registrado, pero no se contabiliza todavía.' }],
      }), error: null,
    })
    montar()
    expect((await screen.findByText(/Cuenta de anticipos sin configurar/)).closest('[role="alert"]')).toBeTruthy()
    const nota = screen.getByRole('note', { name: 'Anticipos sin contabilizar' })
    expect(within(nota).getByText(/60\.00 — El anticipo quedó registrado/)).toBeTruthy()
    expect(screen.getByText('Sin saldos a favor.')).toBeTruthy()
  })

  it('registrar anticipo: el titular del sujeto viaja fijo, con la clave del formulario', async () => {
    h.respuestas.conta_registrar_anticipo = () => ({
      data: [{ pago_id: 'k-1', repetido: false, resultado: 'contabilizada', codigo: null, motivo: null,
        asiento_id: 'as-7', asiento_numero: 40, saldo_a_favor: 60 }], error: null,
    })
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar anticipo' }))
    const form = screen.getByRole('group', { name: 'Registrar anticipo' })
    expect((within(form).getByLabelText('Cliente del anticipo') as HTMLSelectElement).disabled).toBe(true)
    fireEvent.change(within(form).getByLabelText('Unidad del anticipo'), { target: { value: 'u-1' } })
    fireEvent.change(within(form).getByLabelText('Importe del anticipo'), { target: { value: '60' } })
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Registrar' })) })
    await waitFor(() => expect(llamadasA('conta_registrar_anticipo')).toHaveLength(1))
    const args = llamadasA('conta_registrar_anticipo')[0].args
    expect(args).toMatchObject({ p_project_id: 'p-1', p_unidad_id: 'u-1', p_cliente_id: 'cli-1', p_monto: 60, p_metodo: 'efectivo' })
    expect(typeof args.p_pago_id).toBe('string')
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'success', title: 'Anticipo registrado',
    })))
  })
})
