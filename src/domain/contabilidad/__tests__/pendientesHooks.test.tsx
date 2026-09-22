// Hooks de la bandeja de pendientes: qué viaja al servidor y qué se refresca.
//
// La RPC se sustituye por un espía: lo que se fija es el CONTRATO con el
// servidor (sólo el id en el reproceso; filtro y página en la bandeja) y que un
// reproceso refresque la bandeja entera, no sólo la página visible.
import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const rpc = vi.hoisted(() => vi.fn())

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => ({
      abortSignal: () => rpc(fn, args),
    }),
  },
  warmUpSupabase: vi.fn(),
}))

import { useFacturasPendientesQuery, PENDIENTES_POR_PAGINA } from '../queries'
import { useReprocesarFacturaMutation } from '../mutations'
import { contabilidadKeys } from '../keys'

function envoltorio(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

describe('useFacturasPendientesQuery', () => {
  it('pide al servidor la página, el filtro y la búsqueda del ledger activo', async () => {
    rpc.mockResolvedValueOnce({ data: [{ factura_id: 'f1', total_filas: 7 }], error: null })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(
      () => useFacturasPendientesQuery({ companyId: 'c1', projectId: 'p1', codigo: 'sin_cuenta', busqueda: ' bomba ', pagina: 2 }),
      { wrapper: envoltorio(qc) },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(rpc).toHaveBeenCalledWith('conta_facturas_pendientes', {
      p_project_id: 'p1',
      p_codigo: 'sin_cuenta',
      p_busqueda: 'bomba',
      p_limite: PENDIENTES_POR_PAGINA,
      p_offset: 2 * PENDIENTES_POR_PAGINA,
    })
    expect(result.current.data).toEqual({ filas: [{ factura_id: 'f1', total_filas: 7 }], total: 7 })
  })
})

describe('useReprocesarFacturaMutation', () => {
  it('envía SÓLO el id y refresca toda la bandeja y el historial', async () => {
    rpc.mockResolvedValueOnce({ data: [{ resultado: 'contabilizada', asiento_id: 'a1' }], error: null })
    const qc = new QueryClient()
    const invalidar = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useReprocesarFacturaMutation('c1'), { wrapper: envoltorio(qc) })

    const r = await result.current.mutateAsync('fac-1')

    expect(rpc).toHaveBeenLastCalledWith('conta_reprocesar_factura_proveedor', { p_factura_id: 'fac-1' })
    expect(r.resultado).toBe('contabilizada')
    await waitFor(() => expect(invalidar).toHaveBeenCalledWith({ queryKey: contabilidadKeys.pendientesDeEmpresa('c1') }))
    expect(invalidar).toHaveBeenCalledWith({ queryKey: contabilidadKeys.intentos('fac-1') })
  })

  it('también refresca si el servidor rechaza (la bandeja puede haber cambiado)', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'No autorizado para contabilizar facturas.', code: '42501' } })
    const qc = new QueryClient()
    const invalidar = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useReprocesarFacturaMutation('c1'), { wrapper: envoltorio(qc) })

    await expect(result.current.mutateAsync('fac-1')).rejects.toBeTruthy()
    await waitFor(() => expect(invalidar).toHaveBeenCalledWith({ queryKey: contabilidadKeys.pendientesDeEmpresa('c1') }))
  })
})
