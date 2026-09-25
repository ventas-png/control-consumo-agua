// Si un cobro de cargo adicional llegara a la pantalla de agua por otra vía que
// `fetchPagosYConvenios` (que ya los excluye), verificarlo o rechazarlo desde
// aquí NO debe llamar a las mutaciones de agua: se remite a su propio flujo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { UserSession } from '../../../types'

vi.mock('../../../lib/supabase', () => {
  const cadena: unknown = new Proxy(function () {} as unknown as object, {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
      return () => cadena
    },
    apply: () => cadena,
  })
  return { supabase: { from: () => cadena, rpc: () => cadena }, db: { from: () => cadena, rpc: () => cadena } }
})
vi.mock('../../../lib/storageUrls', () => ({ useSignedUrl: () => null }))
// La carga se simula DEVOLVIENDO el cobro de cargo, para ejercitar el guard.
vi.mock('../../../domain/cobros/queries', () => ({
  fetchPagosYConvenios: vi.fn(async () => ({
    pagos: [{
      id: 'cargo-pend', cliente_id: 'cli-1', cargo_adicional_id: 'ca1', monto: 7,
      metodo: 'efectivo', estado: 'pendiente', verification_status: 'pendiente',
      created_at: new Date().toISOString(),
    }],
    convenios: [],
  })),
  esCobroDeCargoAdicional: (p: { cargo_adicional_id?: string | null }) => p.cargo_adicional_id != null,
}))
const verifyPago = vi.fn(async () => ({ error: null }))
const rejectPago = vi.fn(async () => ({ error: null }))
vi.mock('../../../domain/cobros/mutations', () => ({
  verifyPago: (...a: unknown[]) => verifyPago(...(a as [])),
  rejectPago: (...a: unknown[]) => rejectPago(...(a as [])),
  setConvenioEstado: vi.fn(),
}))
const registrarPagoRegistro = vi.fn(async () => ({ data: null, error: null }))
vi.mock('../../../domain/agua/mutations', () => ({
  registrarPagoRegistro: (...a: unknown[]) => registrarPagoRegistro(...(a as [])),
  marcarRegistrosMora: vi.fn(async () => ({ error: null })),
}))
const notify = vi.fn()
vi.mock('../../shared/Dialog', () => ({
  notify: (...a: unknown[]) => notify(...a),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
}))
const openPromptDialog = vi.fn(async () => ({ razon: 'x' }))
vi.mock('../../shared/PromptDialog', () => ({
  openPromptDialog: (...a: unknown[]) => openPromptDialog(...(a as [])),
}))

const { CobrosSection } = await import('../CobrosSection')
const { SessionProvider } = await import('../../shared/SessionContext')
const { PermissionsProvider } = await import('../../shared/PermissionsContext')

const currentUser = { user_id: 'u1', company_id: 'emp-1', role: 'admin', name: 'Admin' } as unknown as UserSession

async function abrirVerificaciones() {
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
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /Verificaciones Pendientes/ })) })
}

beforeEach(() => { cleanup(); vi.clearAllMocks() })
afterEach(cleanup)

describe('CobrosSection — guard de acciones sobre cobros de cargos', () => {
  it('rechazar no llama al rechazo genérico ni pide motivo; remite a Cargos adicionales', async () => {
    await abrirVerificaciones()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Rechazar/ })) })
    expect(openPromptDialog).not.toHaveBeenCalled()
    expect(rejectPago).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'warning',
      text: expect.stringContaining('Condominios › Cargos adicionales › Cobros'),
    }))
  })

  it('verificar no llama a la verificación ni aplica el pago a una lectura', async () => {
    await abrirVerificaciones()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Verificar/ })) })
    expect(verifyPago).not.toHaveBeenCalled()
    expect(registrarPagoRegistro).not.toHaveBeenCalled()
  })
})
