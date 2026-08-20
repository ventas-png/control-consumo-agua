// Regresión react-hooks/exhaustive-deps (CobrosSection:261).
//
// El memo de `saldoSeleccionado` llamaba a `getSaldo`, una función declarada en
// el cuerpo del componente y por tanto recreada en cada render: declararla como
// dependencia habría anulado la memoización, y omitirla dejaba el aviso. La
// corrección es sacarla (junto a `getTotal`) al ámbito de módulo, porque son
// puras sobre la fila. Estas pruebas fijan el resultado del memo para que el
// movimiento no cambie ninguna cifra.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Registro, UserSession } from '../../../types'

vi.mock('../../../lib/supabase', () => {
  const cadena: unknown = new Proxy(function () {} as unknown as object, {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
      return () => cadena
    },
    apply: () => cadena,
  })
  return { supabase: { from: () => cadena, rpc: () => cadena }, db: { from: () => cadena } }
})
vi.mock('../../../lib/storageUrls', () => ({ useSignedUrl: () => null }))
vi.mock('../../../domain/cobros/queries', () => ({
  fetchPagosYConvenios: vi.fn(async () => ({ pagos: [], convenios: [] })),
}))
vi.mock('../../../domain/cobros/mutations', () => ({
  verifyPago: vi.fn(), rejectPago: vi.fn(), setConvenioEstado: vi.fn(),
}))
vi.mock('../../../domain/agua/mutations', () => ({
  updateRegistro: vi.fn(async () => ({ error: null })),
  marcarRegistrosMora: vi.fn(async () => ({ error: null })),
}))
vi.mock('../../shared/Dialog', () => ({
  notify: vi.fn(), confirm: vi.fn(async () => ({ isConfirmed: true })),
}))

const { CobrosSection } = await import('../CobrosSection')
const { SessionProvider } = await import('../../shared/SessionContext')
const { PermissionsProvider } = await import('../../shared/PermissionsContext')

const currentUser = {
  user_id: 'u1', company_id: 'emp-1', role: 'admin', name: 'Admin',
} as unknown as UserSession

function registro(id: string, over: Partial<Registro> = {}): Registro {
  return {
    id, cliente_id: 'cli-1', cliente_nombre: 'Ana', fecha: '2026-08-01',
    lectura_anterior: 0, lectura_actual: 10, consumo: 10,
    tarifa_aplicada: 25, canon_aplicado: 20, monto_calculado: 100,
    monto_pagado: 0, estado: 'pendiente', mes: 'Agosto 2026',
    ...over,
  } as unknown as Registro
}

/** Texto del indicador "Saldo seleccionado" de la barra de selección (el nodo
 *  está partido en varios hijos, de ahí la lectura por textContent). */
function saldoSeleccionado(): string {
  return document.body.textContent ?? ''
}

function renderSection(registros: Registro[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SessionProvider value={currentUser}>
        <PermissionsProvider>
          <CobrosSection
            registros={registros} clientes={[{ id: 'cli-1', nombre: 'Ana' } as never]}
            moneda="Q" onEstadoUpdated={vi.fn()}
          />
        </PermissionsProvider>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

beforeEach(cleanup)
afterEach(cleanup)

describe('CobrosSection — saldo seleccionado', () => {
  it('suma el saldo de las filas seleccionadas descontando lo ya pagado', async () => {
    await act(async () => {
      renderSection([
        registro('r1', { monto_calculado: 100, monto_pagado: 0 }),
        registro('r2', { monto_calculado: 100, monto_pagado: 40 }),
      ])
    })

    const casillas = screen.getAllByRole('checkbox')
    await act(async () => { casillas.forEach(c => fireEvent.click(c)) })

    // 100 + 60 = 160.
    expect(saldoSeleccionado()).toContain('Q 160.00')
  })

  it('un sobrepago no resta del total (saldo mínimo 0)', async () => {
    await act(async () => {
      renderSection([
        registro('r1', { monto_calculado: 100, monto_pagado: 0 }),
        registro('r2', { monto_calculado: 50, monto_pagado: 500 }),
      ])
    })

    const casillas = screen.getAllByRole('checkbox')
    await act(async () => { casillas.forEach(c => fireEvent.click(c)) })

    // 100 + max(0, 50 - 500) = 100: el sobrepago no resta.
    expect(saldoSeleccionado()).toContain('Q 100.00')
  })
})
