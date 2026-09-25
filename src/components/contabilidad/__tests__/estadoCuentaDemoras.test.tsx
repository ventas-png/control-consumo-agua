// Estado de cuenta con respuestas DEMORADAS — hooks reales (TanStack Query) y
// un `supabase.rpc` falso cuyas respuestas se liberan a mano, en el orden que
// cada prueba elige.
//
// Lo que se fija: mientras la respuesta de la consulta NUEVA no llega, la
// pantalla no muestra el resultado de la anterior como si fuera vigente.
//   · cambiar de cliente A → B: nada de A queda a la vista;
//   · cambiar la fecha de corte: nada del corte anterior queda a la vista;
//   · una respuesta vieja que llega TARDE (después de la nueva) no pisa la
//     nueva;
//   · paginar la MISMA consulta sí conserva la página anterior, rotulada
//     «Actualizando…».
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DocumentoFueraDeSaldo, EstadoCuenta, MovimientoEstadoCuenta } from '../../../types/contabilidad'

interface Llamada {
  fn: string
  args: Record<string, unknown>
  resolver: (data: unknown) => void
}

const rpc = vi.hoisted(() => ({ llamadas: [] as Llamada[] }))

vi.mock('../../../lib/supabase', () => ({
  warmUpSupabase: vi.fn(),
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => ({
      abortSignal: () =>
        new Promise((resolve) => {
          rpc.llamadas.push({ fn, args, resolver: (data) => resolve({ data, error: null }) })
        }),
    }),
  },
}))
vi.mock('../../../domain/contabilidad/queries', async (original) => ({
  ...(await original<typeof import('../../../domain/contabilidad/queries')>()),
  useAuxiliaresQuery: () => ({
    data: [
      { cliente_id: 'cli-a', cliente_nombre: 'Cliente A', cliente_codigo: null, auxiliar_id: null, codigo: 'AUX-A', activo: true },
      { cliente_id: 'cli-b', cliente_nombre: 'Cliente B', cliente_codigo: null, auxiliar_id: null, codigo: 'AUX-B', activo: true },
    ],
  }),
  useUnidadesLedgerQuery: () => ({ data: [] }),
}))
vi.mock('../AsientoDetalleModal', () => ({ AsientoDetalleModal: () => null }))

import { EstadoCuentaTab } from '../EstadoCuentaTab'
import { ESTADO_CUENTA_POR_PAGINA } from '../../../domain/contabilidad/queries'

function estado(nombre: string, saldo: number, movimientos = 1, pagina = 0): EstadoCuenta {
  const mov: MovimientoEstadoCuenta = {
    n: pagina * ESTADO_CUENTA_POR_PAGINA + 1, linea_id: `l-${nombre}-${pagina}`, asiento_id: `as-${nombre}`, asiento_numero: 1,
    fecha: '2026-01-10', origen: 'automatico', documento_tabla: 'cuotas_condominio', documento_id: 'k',
    evento: 'cuota_emitida', documento: `Cuota de ${nombre} p${pagina + 1}`, concepto: 'c', descripcion: null,
    tipo_cargo: 'mantenimiento', componente: 'principal', cuota_id: null, cuenta_id: 'c', cuenta_codigo: '1',
    cuenta_nombre: 'CxC', unidad_id: null, unidad_nombre: null, auxiliar_id: null, auxiliar_nombre: null,
    es_reverso: false, reversa_de_id: null, reversa_de_numero: null, reversado_por_id: null,
    reversado_por_numero: null, reversado_por_fecha: null, cargo: saldo, abono: 0, saldo,
  }
  return {
    sujeto: { tipo: 'cliente', id: `cli-${nombre}`, nombre: `Cliente ${nombre}`, codigo_auxiliar: null },
    project_id: 'p-1', desde: null, hasta: null,
    resumen: { saldo_inicial: 0, cargos: saldo, abonos: 0, saldo_final: saldo, movimientos },
    por_tipo: [], fuera_de_saldo: [], limitaciones: [], limite: ESTADO_CUENTA_POR_PAGINA, offset: 0,
    movimientos: [mov],
  }
}

function fueraFila(concepto: string): DocumentoFueraDeSaldo {
  return {
    clase: 'pendiente', naturaleza: 'cargo', origen_tabla: 'cuotas_condominio', origen_id: concepto, evento: 'cuota_emitida',
    fecha: '2026-01-10', concepto, tipo_cargo: 'mantenimiento', unidad_id: null, unidad_nombre: null,
    responsable_id: null, responsable_nombre: null, monto: 10, estado_actual: 'pendiente', codigo: 'sin_configuracion',
    motivo: `Motivo ${concepto}`, asiento_id: null, asiento_numero: null, asiento_fecha: null, limitacion: null, total_filas: 1,
  }
}

/** La última llamada pendiente a `fn` que cumple `filtro`. */
function llamada(fn: string, filtro: (a: Record<string, unknown>) => boolean = () => true): Llamada {
  const xs = rpc.llamadas.filter((l) => l.fn === fn && filtro(l.args))
  if (xs.length === 0) throw new Error(`sin llamada a ${fn}`)
  return xs[xs.length - 1]
}

async function responder(l: Llamada, data: unknown) {
  await act(async () => {
    l.resolver(data)
    await Promise.resolve()
  })
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  render(
    <QueryClientProvider client={qc}>
      <EstadoCuentaTab companyId="c1" projectId="p-1" monedaBase="GTQ" />
    </QueryClientProvider>,
  )
}

const elegir = (id: string) => fireEvent.change(screen.getByLabelText('Auxiliar'), { target: { value: id } })
const esCliente = (id: string) => (a: Record<string, unknown>) => a.p_cliente_id === id

beforeEach(() => {
  rpc.llamadas = []
})
afterEach(cleanup)

describe('EstadoCuentaTab con respuestas demoradas', () => {
  it('cliente A → B: mientras B no responde, nada de A se muestra como vigente', async () => {
    montar()
    elegir('cli-a')
    await responder(llamada('conta_estado_cuenta', esCliente('cli-a')), estado('A', 111))
    await responder(llamada('conta_estado_cuenta_pendientes', esCliente('cli-a')), [fueraFila('Pendiente de A')])
    expect(await screen.findByRole('heading', { name: 'Cliente A' })).toBeTruthy()
    expect(screen.getByText('Pendiente de A')).toBeTruthy()

    elegir('cli-b')
    // B todavía no respondió.
    expect(screen.getByText('Calculando estado de cuenta…')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Cliente A' })).toBeNull()
    expect(screen.queryByText(/111\.00/)).toBeNull()
    expect(screen.queryByText('Pendiente de A')).toBeNull()

    await responder(llamada('conta_estado_cuenta', esCliente('cli-b')), estado('B', 222))
    await responder(llamada('conta_estado_cuenta_pendientes', esCliente('cli-b')), [fueraFila('Pendiente de B')])
    expect(await screen.findByRole('heading', { name: 'Cliente B' })).toBeTruthy()
    expect(screen.getByText('Pendiente de B')).toBeTruthy()
    expect(screen.queryByText(/111\.00/)).toBeNull()
  })

  it('una respuesta de A que llega TARDE, después de la de B, no pisa a B', async () => {
    montar()
    elegir('cli-a')
    const aTarde = llamada('conta_estado_cuenta', esCliente('cli-a'))
    elegir('cli-b')
    await responder(llamada('conta_estado_cuenta', esCliente('cli-b')), estado('B', 222))
    expect(await screen.findByRole('heading', { name: 'Cliente B' })).toBeTruthy()
    await responder(aTarde, estado('A', 111))
    expect(screen.getByRole('heading', { name: 'Cliente B' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Cliente A' })).toBeNull()
    expect(screen.queryByText(/111\.00/)).toBeNull()
  })

  it('cambiar la fecha de corte: el resultado del corte anterior no queda a la vista', async () => {
    montar()
    elegir('cli-a')
    await responder(llamada('conta_estado_cuenta', (a) => a.p_hasta === null), estado('A', 111))
    await responder(llamada('conta_estado_cuenta_pendientes', (a) => a.p_hasta === null), [fueraFila('Pendiente hoy')])
    expect(await screen.findByText('Pendiente hoy')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Hasta (corte)'), { target: { value: '2026-01-31' } })
    expect(screen.getByText('Calculando estado de cuenta…')).toBeTruthy()
    expect(screen.queryByText(/111\.00/)).toBeNull()
    expect(screen.queryByText('Pendiente hoy')).toBeNull()

    await responder(llamada('conta_estado_cuenta', (a) => a.p_hasta === '2026-01-31'), estado('A', 33))
    await responder(llamada('conta_estado_cuenta_pendientes', (a) => a.p_hasta === '2026-01-31'), [fueraFila('Pendiente en enero')])
    expect(await screen.findByText('Pendiente en enero')).toBeTruthy()
    const resumen = screen.getByRole('heading', { name: 'Cliente A' }).parentElement!
    expect(within(resumen).getByText('Saldo final', { selector: 'dt' }).nextSibling?.textContent).toContain('33.00')
    expect(screen.queryByText('Pendiente hoy')).toBeNull()
  })

  it('paginar la MISMA consulta conserva la página anterior, rotulada «Actualizando»', async () => {
    montar()
    elegir('cli-a')
    await responder(llamada('conta_estado_cuenta', (a) => a.p_offset === 0), estado('A', 111, ESTADO_CUENTA_POR_PAGINA * 2))
    expect(await screen.findByText('Cuota de A p1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    // La página 2 todavía no llegó: se ve la 1, marcada como actualizando.
    expect(screen.getByText('Cuota de A p1')).toBeTruthy()
    expect(screen.getByText(/Actualizando: se muestra la página anterior de esta misma consulta/)).toBeTruthy()

    await responder(llamada('conta_estado_cuenta', (a) => a.p_offset === ESTADO_CUENTA_POR_PAGINA),
      estado('A', 111, ESTADO_CUENTA_POR_PAGINA * 2, 1))
    expect(await screen.findByText('Cuota de A p2')).toBeTruthy()
    expect(screen.queryByText(/Actualizando: se muestra la página anterior/)).toBeNull()
  })

  it('cambiar de cliente estando en la página 2 pide la página 1 del nuevo, sin pasar por su página 2', async () => {
    montar()
    elegir('cli-a')
    await responder(llamada('conta_estado_cuenta', (a) => a.p_offset === 0), estado('A', 111, ESTADO_CUENTA_POR_PAGINA * 2))
    await screen.findByText('Cuota de A p1')
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    elegir('cli-b')
    const deB = rpc.llamadas.filter((l) => l.fn === 'conta_estado_cuenta' && l.args.p_cliente_id === 'cli-b')
    expect(deB.length).toBeGreaterThan(0)
    expect(deB.every((l) => l.args.p_offset === 0)).toBe(true)
    expect(screen.queryByText(/Cuota de A/)).toBeNull()
  })
})
