// Los pasos que mueven dinero o documentos (aprobar factura, aprobar/pagar/anular orden de pago, cambiar el estado de una
// orden de compra o de una recepción) NO deben mostrarse como hechos si el servidor no cambió ninguna fila. PostgREST
// devuelve éxito con cero filas cuando la política de filas (RLS) no deja tocar; antes la pantalla decía «Listo».
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const h = vi.hoisted(() => ({ filas: [] as unknown[], error: null as { message: string } | null, llamadas: [] as string[] }))

vi.mock('../../../lib/supabase', () => {
  const cadena = (tabla: string) => {
    const c: Record<string, unknown> = {}
    c.update = () => c
    c.delete = () => c
    c.insert = () => c
    c.eq = () => c
    c.select = (cols?: string) => { h.llamadas.push(`${tabla}.select(${cols ?? ''})`); return c }
    c.abortSignal = () => Promise.resolve({ data: h.filas, error: h.error })
    return c
  }
  return {
    supabase: { from: (t: string) => cadena(t), auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) } },
    warmUpSupabase: vi.fn(),
  }
})

import { SinFilasAfectadasError } from '../../queryFetch'
import {
  useAnularFacturaMutation, useAnularOrdenMutation, useAprobarFacturaMutation, useAprobarOrdenMutation, useMarcarOrdenPagadaMutation,
} from '../mutations'
import {
  useAnularContrasenaMutation, useAprobarFacturaConCuadreMutation, useCambiarEstadoOrdenCompraMutation,
  useCambiarEstadoRecepcionMutation, useEliminarOrdenCompraMutation,
} from '../../compras/mutations'

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>
)

beforeEach(() => { h.filas = []; h.error = null; h.llamadas = [] })

const casos: Array<[string, () => { mutateAsync: (v: never) => Promise<unknown> }, unknown]> = [
  ['aprobar factura', () => useAprobarFacturaMutation('c1') as never, 'f1'],
  ['anular factura', () => useAnularFacturaMutation('c1') as never, 'f1'],
  ['aprobar orden de pago', () => useAprobarOrdenMutation('c1') as never, 'o1'],
  ['marcar pagada la orden de pago', () => useMarcarOrdenPagadaMutation('c1') as never, { ordenId: 'o1' }],
  ['anular orden de pago', () => useAnularOrdenMutation('c1') as never, 'o1'],
  ['cambiar el estado de una orden de compra', () => useCambiarEstadoOrdenCompraMutation() as never, { id: 'o1', estado: 'aprobada' }],
  ['eliminar una orden de compra', () => useEliminarOrdenCompraMutation() as never, 'o1'],
  ['cambiar el estado de una recepción', () => useCambiarEstadoRecepcionMutation() as never, { id: 'r1', estado: 'registrada' }],
  ['anular una contraseña de pago', () => useAnularContrasenaMutation() as never, { id: 'k1', motivo: 'error' }],
  ['aprobar factura con cuadre', () => useAprobarFacturaConCuadreMutation() as never, { facturaId: 'f1' }],
]

describe('pasos de compras y pagos: cero filas cambiadas NO es éxito', () => {
  it.each(casos)('%s: con cero filas lanza SinFilasAfectadasError', async (_n, hook, vars) => {
    h.filas = []
    const { result } = renderHook(hook, { wrapper })
    await expect(result.current.mutateAsync(vars as never)).rejects.toBeInstanceOf(SinFilasAfectadasError)
  })

  it.each(casos)('%s: con la fila devuelta es éxito y pidió las filas de vuelta (.select)', async (_n, hook, vars) => {
    h.filas = [{ id: 'x' }]
    const { result } = renderHook(hook, { wrapper })
    await expect(result.current.mutateAsync(vars as never)).resolves.not.toThrow()
    expect(h.llamadas.some((l) => l.endsWith('.select(id)'))).toBe(true)
  })

  it('un rechazo del servidor conserva su mensaje (no se disfraza de «sin filas»)', async () => {
    h.error = { message: 'COMPRAS_PAGO_EXCEDE_SALDO: la factura tiene un saldo de 100' }
    const { result } = renderHook(() => useMarcarOrdenPagadaMutation('c1'), { wrapper })
    await expect(result.current.mutateAsync({ ordenId: 'o1' })).rejects.toThrow(/COMPRAS_PAGO_EXCEDE_SALDO/)
  })
})
