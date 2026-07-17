// Fase 6 — Contrato de runQueryAll: listados completos por chunks con el mismo
// manejo de errores de runQuery (lanza QueryError → react-query isError).
import { describe, it, expect, vi } from 'vitest'
import type { PostgrestError } from '@supabase/supabase-js'
import { runQueryAll, QueryError } from '../queryFetch'

function page<T>(rows: T[]): { data: T[]; error: null } {
  return { data: rows, error: null }
}

describe('runQueryAll', () => {
  it('una página parcial → devuelve las filas', async () => {
    const rows = await runQueryAll<{ id: number }>((from, _to) =>
      Promise.resolve(page(from === 0 ? [{ id: 1 }, { id: 2 }] : [])),
    )
    expect(rows).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('varias páginas: concatena hasta la ventana incompleta', async () => {
    // chunk default = 1000; simulamos 1000 llenas + 500
    const rows = await runQueryAll<{ id: number }>((from, to) => {
      const n = from === 0 ? to - from + 1 : 500
      return Promise.resolve(page(Array.from({ length: n }, (_, i) => ({ id: from + i }))))
    })
    expect(rows).toHaveLength(1500)
    expect(rows[0].id).toBe(0)
    expect(rows[1499].id).toBe(1499)
  })

  it('pasa un AbortSignal fresco a cada chunk', async () => {
    const signals: AbortSignal[] = []
    await runQueryAll<{ id: number }>((from, _to, signal) => {
      signals.push(signal)
      return Promise.resolve(page(from === 0 ? Array.from({ length: 1000 }, (_, i) => ({ id: i })) : []))
    })
    expect(signals).toHaveLength(2)
    expect(signals[0]).toBeInstanceOf(AbortSignal)
    expect(signals[0]).not.toBe(signals[1]) // timeout independiente por ventana
  })

  it('error → lanza QueryError (contrato de runQuery)', async () => {
    const err = { message: 'rls denied' } as PostgrestError
    await expect(
      runQueryAll(() => Promise.resolve({ data: null, error: err })),
    ).rejects.toThrow(QueryError)
    await expect(
      runQueryAll(() => Promise.resolve({ data: null, error: err })),
    ).rejects.toThrow('rls denied')
  })

  it('techo de seguridad: avisa por consola y devuelve lo acumulado', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // Fuente "infinita": toda ventana vuelve llena → corta en el techo (100k).
      const rows = await runQueryAll<{ id: number }>((from, to) =>
        Promise.resolve(page(Array.from({ length: to - from + 1 }, (_, i) => ({ id: from + i })))),
      )
      expect(rows.length).toBeGreaterThanOrEqual(100_000)
      expect(warn).toHaveBeenCalledOnce()
      expect(String(warn.mock.calls[0][0])).toContain('techo de seguridad')
    } finally {
      warn.mockRestore()
    }
  })
})
