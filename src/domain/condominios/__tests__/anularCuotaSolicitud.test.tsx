// Anular una cuota (20261012000000): la pantalla SOLICITA (conta_ajuste_solicitar)
// y nunca escribe la cuota. El servidor rechaza el UPDATE directo
// (CUOTA_ANULACION_SOLO_POR_SOLICITUD) y lo prueba supabase/tests/conta_ajustes.
import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const sb = vi.hoisted(() => ({
  from: vi.fn(() => { throw new Error('anular una cuota no debe escribir tablas desde el cliente') }),
  rpc: vi.fn((_n: string, _a: Record<string, unknown>) => ({
    abortSignal: async () => ({ data: [{ solicitud_id: 'sol-1', estado: 'pendiente', repetida: false }], error: null }),
  })),
}))
vi.mock('../../../lib/supabase', () => {
  const client = { from: sb.from, rpc: sb.rpc }
  return { supabase: client, db: client, warmUpSupabase: vi.fn() }
})

import { useAnularCuotaMutation, TransicionCuotaInvalidaError } from '../mutations'

function envoltorio() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useAnularCuotaMutation (por solicitud)', () => {
  it('registra una solicitud anular_cuota con el motivo y no escribe la cuota', async () => {
    const { result } = renderHook(() => useAnularCuotaMutation(), { wrapper: envoltorio() })
    let r: unknown
    await act(async () => {
      r = await result.current.mutateAsync({ cuota: { id: 'cu-1', cuota_estado: 'emitida' }, motivo: '  emitida por error  ', clave: 'k-1' })
    })
    expect(r).toEqual({ solicitud_id: 'sol-1', estado: 'pendiente', repetida: false })
    expect(sb.rpc).toHaveBeenCalledWith('conta_ajuste_solicitar', {
      p_id: 'k-1', p_tipo: 'anular_cuota', p_documento_tabla: 'cuotas_condominio',
      p_documento_id: 'cu-1', p_motivo: 'emitida por error',
    })
    expect(sb.from).not.toHaveBeenCalled()
  })

  it('una cuota ya anulada o pagada no se solicita (la máquina de estados lo impide antes)', async () => {
    sb.rpc.mockClear()
    const { result } = renderHook(() => useAnularCuotaMutation(), { wrapper: envoltorio() })
    await act(async () => {
      await expect(result.current.mutateAsync({ cuota: { id: 'cu-2', cuota_estado: 'anulada' }, motivo: 'otra vez' }))
        .rejects.toBeInstanceOf(TransicionCuotaInvalidaError)
    })
    expect(sb.rpc).not.toHaveBeenCalled()
  })
})
