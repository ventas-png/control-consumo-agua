import { describe, it, expect } from 'vitest'
import { fetchAllRows, type ChunkResult } from '../fetchAllRows'

function fakeSource(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }))
  const calls: Array<[number, number]> = []
  const fetchChunk = (from: number, to: number): Promise<ChunkResult<{ id: number }>> => {
    calls.push([from, to])
    return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
  }
  return { fetchChunk, calls }
}

describe('fetchAllRows', () => {
  it('una sola página (menos filas que el chunk)', async () => {
    const { fetchChunk, calls } = fakeSource(3)
    const r = await fetchAllRows(fetchChunk, { chunkSize: 10 })
    expect(r.data).toHaveLength(3)
    expect(r.truncated).toBe(false)
    expect(r.error).toBeNull()
    expect(calls).toEqual([[0, 9]])
  })

  it('varias páginas completas + una parcial trae todo', async () => {
    const { fetchChunk, calls } = fakeSource(25)
    const r = await fetchAllRows(fetchChunk, { chunkSize: 10 })
    expect(r.data).toHaveLength(25)
    expect(r.data.map(x => x.id)).toEqual(Array.from({ length: 25 }, (_, i) => i))
    expect(calls).toEqual([[0, 9], [10, 19], [20, 29]])
  })

  it('total múltiplo exacto del chunk: una lectura extra vacía y para', async () => {
    const { fetchChunk, calls } = fakeSource(20)
    const r = await fetchAllRows(fetchChunk, { chunkSize: 10 })
    expect(r.data).toHaveLength(20)
    expect(calls).toEqual([[0, 9], [10, 19], [20, 29]])
  })

  it('supera el tope de PostgREST (>1000): con chunk default trae todo', async () => {
    const { fetchChunk } = fakeSource(2300)
    const r = await fetchAllRows(fetchChunk)
    expect(r.data).toHaveLength(2300)
    expect(r.truncated).toBe(false)
  })

  it('propaga el error y devuelve lo acumulado hasta ese punto', async () => {
    let n = 0
    const fetchChunk = (): Promise<ChunkResult<{ id: number }>> => {
      n++
      if (n === 2) return Promise.resolve({ data: null, error: { message: 'boom' } })
      return Promise.resolve({ data: Array.from({ length: 10 }, (_, i) => ({ id: i })), error: null })
    }
    const r = await fetchAllRows(fetchChunk, { chunkSize: 10 })
    expect(r.error).toBe('boom')
    expect(r.data).toHaveLength(10)
    expect(r.truncated).toBe(false)
  })

  it('corta en el techo de seguridad y marca truncated', async () => {
    // Fuente "infinita": cada chunk vuelve completo.
    const fetchChunk = (from: number, to: number): Promise<ChunkResult<{ id: number }>> =>
      Promise.resolve({ data: Array.from({ length: to - from + 1 }, (_, i) => ({ id: from + i })), error: null })
    const r = await fetchAllRows(fetchChunk, { chunkSize: 10, ceiling: 25 })
    expect(r.truncated).toBe(true)
    expect(r.data).toHaveLength(30) // se detiene al cruzar el techo, no antes
  })
})
