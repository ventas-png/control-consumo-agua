// Cobros de AGUA vs cobros de cargos adicionales (20261004000000).
//
// Un cobro de cargo adicional es un `pagos` con `cargo_adicional_id`: se registra
// y se anula sólo en Condominios › Cargos adicionales › Cobros, y el servidor
// rechaza el rechazo genérico (COBRO_CARGO_SOLO_RPC). En la pantalla de Cobros de
// agua no debe aparecer ni sumar, ni ofrecer verificar/rechazar.
//
// Se usa el `fetchPagosYConvenios` REAL sobre un cliente falso que aplica los
// `.is(col, null)` como lo haría el servidor, para que las pestañas, los KPI y
// los totales se prueben sobre el conjunto que de verdad llega a la pantalla.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { UserSession } from '../../../types'

const hoy = new Date().toISOString()

type Fila = Record<string, unknown>
const tablas: Record<string, Fila[]> = {}
/** `true` simula un servidor que NO aplica el filtro (la frontera debe cubrirlo). */
let servidorIgnoraFiltro = false

vi.mock('../../../lib/supabase', () => {
  function consulta(tabla: string) {
    const filtros: [string, unknown][] = []
    const resolver = () => {
      let filas = tablas[tabla] ?? []
      for (const [col, valor] of filtros) {
        if (servidorIgnoraFiltro && col === 'cargo_adicional_id') continue
        filas = filas.filter(f => (f[col] ?? null) === valor)
      }
      return Promise.resolve({ data: filas, error: null })
    }
    const cadena: unknown = new Proxy(function () {} as unknown as object, {
      get(_t, prop) {
        if (prop === 'then') return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => resolver().then(res, rej)
        if (prop === 'is') return (col: string, valor: unknown) => { filtros.push([col, valor]); return cadena }
        return () => cadena
      },
      apply: () => cadena,
    })
    return cadena
  }
  const vacio = () => consulta('__ninguna__')
  const client = { from: consulta, rpc: vacio }
  return { supabase: client, db: client }
})
vi.mock('../../../lib/storageUrls', () => ({ useSignedUrl: () => null }))
const rejectPago = vi.fn(async () => ({ error: null }))
const verifyPago = vi.fn(async () => ({ error: null }))
vi.mock('../../../domain/cobros/mutations', () => ({
  verifyPago: (...a: unknown[]) => verifyPago(...(a as [])),
  rejectPago: (...a: unknown[]) => rejectPago(...(a as [])),
  setConvenioEstado: vi.fn(),
}))
vi.mock('../../../domain/agua/mutations', () => ({
  registrarPagoRegistro: vi.fn(async () => ({ data: null, error: null })),
  marcarRegistrosMora: vi.fn(async () => ({ error: null })),
}))
const notify = vi.fn()
vi.mock('../../shared/Dialog', () => ({
  notify: (...a: unknown[]) => notify(...a),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
}))
vi.mock('../../shared/PromptDialog', () => ({
  openPromptDialog: vi.fn(async () => ({ razon: 'comprobante ilegible' })),
}))

const { CobrosSection } = await import('../CobrosSection')
const { SessionProvider } = await import('../../shared/SessionContext')
const { PermissionsProvider } = await import('../../shared/PermissionsContext')

const currentUser = {
  user_id: 'u1', company_id: 'emp-1', role: 'admin', name: 'Admin',
} as unknown as UserSession

function pago(id: string, over: Fila = {}): Fila {
  return {
    id, cliente_id: 'cli-1', project_id: 'proj-1', registro_id: null, cuota_id: null,
    convenio_id: null, cargo_adicional_id: null, deleted_at: null,
    monto: 0, metodo: 'efectivo', estado: 'verificado', verification_status: 'verificado',
    referencia: null, numero_documento: null, notas: null, created_at: hoy,
    ...over,
  }
}

function sembrar() {
  tablas.pagos = [
    pago('agua-ok', { registro_id: 'r1', monto: 100, referencia: 'REF-AGUA' }),
    pago('agua-pend', { registro_id: 'r1', monto: 40, estado: 'pendiente', verification_status: 'pendiente', numero_documento: 'DOC-AGUA' }),
    pago('cuota', { cuota_id: 'q1', monto: 50, referencia: 'REF-CUOTA' }),
    pago('convenio', { convenio_id: 'cv1', monto: 30, referencia: 'REF-CONV' }),
    // Referencia «de agua» a propósito: se identifica por el vínculo, no por texto.
    pago('cargo-ok', { cargo_adicional_id: 'ca1', monto: 999, referencia: 'Agua enero' }),
    pago('cargo-pend', { cargo_adicional_id: 'ca2', monto: 7, estado: 'pendiente', verification_status: 'pendiente', numero_documento: 'DOC-CARGO' }),
    pago('agua-borrado', { registro_id: 'r1', monto: 5000, deleted_at: hoy }),
  ]
  tablas.convenios_pago = [
    { id: 'cv1', cliente_id: 'cli-1', estado: 'activo', monto_total: 300, monto_pagado: 30, registro_ids: ['r1'], cuotas: null, created_at: hoy },
  ]
}

async function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => {
    render(
      <QueryClientProvider client={qc}>
        <SessionProvider value={currentUser}>
          <PermissionsProvider>
            <CobrosSection registros={[]} clientes={[{ id: 'cli-1', nombre: 'Ana' } as never]} moneda="Q" onEstadoUpdated={vi.fn()} />
          </PermissionsProvider>
        </SessionProvider>
      </QueryClientProvider>,
    )
  })
}

async function abrirPestana(nombre: RegExp) {
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: nombre })) })
}

/** Valor del KPI cuyo rótulo es `rotulo` (el rótulo y la cifra son hermanos). */
function kpi(rotulo: string): string {
  return screen.getByText(rotulo).parentElement?.textContent?.replace(rotulo, '') ?? ''
}

beforeEach(() => {
  cleanup()
  servidorIgnoraFiltro = false
  sembrar()
  rejectPago.mockClear(); verifyPago.mockClear(); notify.mockClear()
})
afterEach(cleanup)

describe('CobrosSection — cobros de cargos adicionales fuera de la vista de agua', () => {
  for (const ignora of [false, true]) {
    const caso = ignora ? 'aunque el servidor no filtrara' : 'con el filtro del servidor'
    it(`historial: sólo agua, cuotas y convenios, y el total es la suma de lo listado (${caso})`, async () => {
      servidorIgnoraFiltro = ignora
      await renderSection()
      await abrirPestana(/Historial de Pagos/)

      expect(screen.getByText('REF-AGUA')).toBeTruthy()
      expect(screen.getByText('REF-CUOTA')).toBeTruthy()
      expect(screen.getByText('REF-CONV')).toBeTruthy()
      expect(screen.queryByText('Agua enero')).toBeNull()
      // 100 + 40 + 50 + 30: ni el 999 ni el 7 de los cargos, ni el borrado.
      expect(screen.getByText('4 pagos')).toBeTruthy()
      expect(screen.getByText('Total: Q 220.00')).toBeTruthy()
      expect(screen.getAllByRole('row').length - 1).toBe(4)
    })

    it(`KPI «Pagos Hoy» cuenta el mismo conjunto (${caso})`, async () => {
      servidorIgnoraFiltro = ignora
      await renderSection()
      expect(kpi('Pagos Hoy')).toBe('4')
      expect(kpi('Convenios Activos')).toBe('1')
    })

    it(`verificaciones: el pago de agua pendiente se ofrece; el del cargo no (${caso})`, async () => {
      servidorIgnoraFiltro = ignora
      await renderSection()
      await abrirPestana(/Verificaciones Pendientes/)
      expect(screen.getByText('DOC-AGUA')).toBeTruthy()
      expect(screen.queryByText('DOC-CARGO')).toBeNull()
      expect(screen.getAllByRole('button', { name: /Rechazar/ })).toHaveLength(1)
    })
  }

  it('rechazar un pago de agua sigue llamando al rechazo de agua', async () => {
    await renderSection()
    await abrirPestana(/Verificaciones Pendientes/)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Rechazar/ })) })
    expect(rejectPago).toHaveBeenCalledTimes(1)
    expect(rejectPago).toHaveBeenCalledWith('agua-pend', 'u1', 'comprobante ilegible')
  })

  it('verificar un pago de agua sigue llamando a la verificación de agua', async () => {
    await renderSection()
    await abrirPestana(/Verificaciones Pendientes/)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Verificar/ })) })
    expect(verifyPago).toHaveBeenCalledWith('agua-pend', 'u1')
  })

  it('convenios: la pestaña sigue mostrando el convenio', async () => {
    await renderSection()
    await abrirPestana(/Convenios/)
    const panel = document.body
    expect(within(panel).getByText(/Q 300\.00/)).toBeTruthy()
  })
})
