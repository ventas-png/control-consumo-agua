// fetchEstadoCuentaCompleto: el PDF necesita TODAS las páginas del rango.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ llamadas: [] as Record<string, unknown>[], total: 0 }))

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (_fn: string, args: Record<string, unknown>) => ({
      abortSignal: async () => {
        h.llamadas.push(args)
        const desde = args.p_offset as number
        const n = Math.max(0, Math.min(args.p_limite as number, h.total - desde))
        return {
          data: {
            sujeto: { tipo: 'cliente', id: 'c1', nombre: 'Ana' }, desde: null, hasta: null,
            resumen: { saldo_inicial: 0, cargos: 0, abonos: 0, saldo_final: 0, movimientos: h.total },
            por_tipo: [], fuera_de_saldo: [], limite: args.p_limite, offset: desde,
            movimientos: Array.from({ length: n }, (_, i) => ({ n: desde + i + 1 })),
          },
          error: null,
        }
      },
    }),
  },
  warmUpSupabase: vi.fn(),
}))

import { fetchEstadoCuentaCompleto } from '../queries'

const pedir = () => fetchEstadoCuentaCompleto({ projectId: 'p1', sujeto: { tipo: 'cliente', id: 'c1' }, desde: null, hasta: '2026-06-30' })

describe('fetchEstadoCuentaCompleto', () => {
  beforeEach(() => { h.llamadas = [] })

  it('un estado que cabe en un lote se pide una sola vez', async () => {
    h.total = 37
    const r = await pedir()
    expect(r.movimientos).toHaveLength(37)
    expect(h.llamadas).toHaveLength(1)
    expect(h.llamadas[0]).toMatchObject({ p_project_id: 'p1', p_cliente_id: 'c1', p_unidad_id: null, p_hasta: '2026-06-30', p_limite: 500, p_offset: 0 })
  })

  it('más de un lote: sigue pidiendo hasta juntar los que el resumen dice que hay, en orden', async () => {
    h.total = 1203
    const r = await pedir()
    expect(r.movimientos).toHaveLength(1203)
    expect(h.llamadas.map((l) => l.p_offset)).toEqual([0, 500, 1000])
    expect((r.movimientos.at(-1) as unknown as { n: number }).n).toBe(1203)
    expect(r.resumen.movimientos).toBe(1203)
  })

  it('exactamente un lote lleno no pide un lote vacío de más', async () => {
    h.total = 500
    const r = await pedir()
    expect(r.movimientos).toHaveLength(500)
    expect(h.llamadas).toHaveLength(1)
  })
})
