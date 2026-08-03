// Contrato de error de useBroadcasts: `fetchBroadcastsWithReadCounts` LANZA si
// falla la lectura (ver domain/comunicacion/__tests__/broadcasts.test.ts). Antes
// el hook no lo capturaba: la promesa quedaba rechazada sin manejar y la lista
// se quedaba vacía, así que en pantalla un fallo real era indistinguible de
// "no hay comunicados enviados todavía" — el síntoma que motivó la revisión del
// área de comunicados/difusión.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  fetchBroadcasts: vi.fn(),
  createBroadcast: vi.fn(),
  fetchClienteBroadcasts: vi.fn(),
  markBroadcastRead: vi.fn(),
}))

vi.mock('../../domain/comunicacion/broadcasts', () => ({
  fetchBroadcastsWithReadCounts: h.fetchBroadcasts,
  createBroadcast: h.createBroadcast,
  fetchClienteBroadcasts: h.fetchClienteBroadcasts,
  markBroadcastRead: h.markBroadcastRead,
}))

import { useBroadcasts } from '../useBroadcasts'

beforeEach(() => {
  h.fetchBroadcasts.mockReset()
  h.createBroadcast.mockReset()
})

describe('useBroadcasts.loadBroadcasts', () => {
  it('carga la lista y deja error en null', async () => {
    h.fetchBroadcasts.mockResolvedValue([{ id: 'b1', read_count: 0 }])
    const { result } = renderHook(() => useBroadcasts())

    await act(async () => { await result.current.loadBroadcasts() })

    expect(result.current.broadcasts).toEqual([{ id: 'b1', read_count: 0 }])
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('captura el fallo, expone el mensaje y apaga el loading', async () => {
    h.fetchBroadcasts.mockRejectedValue(new Error('permission denied for table broadcasts'))
    const { result } = renderHook(() => useBroadcasts())

    await act(async () => { await result.current.loadBroadcasts() })

    await waitFor(() => {
      expect(result.current.error).toBe('permission denied for table broadcasts')
    })
    expect(result.current.broadcasts).toEqual([])
    expect(result.current.loading).toBe(false)
  })

  it('un rechazo sin Error igual produce un mensaje utilizable', async () => {
    h.fetchBroadcasts.mockRejectedValue({ message: 'JWT expired' })
    const { result } = renderHook(() => useBroadcasts())

    await act(async () => { await result.current.loadBroadcasts() })

    expect(result.current.error).toBe('JWT expired')
  })

  it('una recarga con éxito limpia el error previo', async () => {
    h.fetchBroadcasts.mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => useBroadcasts())
    await act(async () => { await result.current.loadBroadcasts() })
    expect(result.current.error).toBe('boom')

    h.fetchBroadcasts.mockResolvedValue([])
    await act(async () => { await result.current.loadBroadcasts() })
    expect(result.current.error).toBeNull()
  })
})
