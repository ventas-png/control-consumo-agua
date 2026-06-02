import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePinnedItems } from '../usePinnedItems'

const KEY = 'test:pinned'

beforeEach(() => {
  window.localStorage.clear()
})

describe('usePinnedItems', () => {
  it('inicia vacio cuando no hay storage previo', () => {
    const { result } = renderHook(() => usePinnedItems(KEY))
    expect(result.current.pinned).toEqual([])
    expect(result.current.isPinned('a')).toBe(false)
  })

  it('pin agrega al frente', () => {
    const { result } = renderHook(() => usePinnedItems(KEY))
    act(() => result.current.pin('a'))
    act(() => result.current.pin('b'))
    expect(result.current.pinned).toEqual(['b', 'a'])
    expect(result.current.isPinned('a')).toBe(true)
    expect(result.current.isPinned('b')).toBe(true)
  })

  it('pin de id ya presente NO lo promueve (semantica estable)', () => {
    const { result } = renderHook(() => usePinnedItems(KEY))
    act(() => result.current.pin('a'))
    act(() => result.current.pin('b'))
    act(() => result.current.pin('a')) // no-op
    expect(result.current.pinned).toEqual(['b', 'a'])
  })

  it('respeta maxItems descartando el mas viejo (FIFO al cap)', () => {
    const { result } = renderHook(() => usePinnedItems(KEY, { maxItems: 2 }))
    act(() => {
      result.current.pin('a')
      result.current.pin('b')
      result.current.pin('c')
    })
    expect(result.current.pinned).toEqual(['c', 'b'])
  })

  it('unpin quita el id', () => {
    const { result } = renderHook(() => usePinnedItems(KEY))
    act(() => {
      result.current.pin('a')
      result.current.pin('b')
    })
    act(() => result.current.unpin('a'))
    expect(result.current.pinned).toEqual(['b'])
    expect(result.current.isPinned('a')).toBe(false)
  })

  it('togglePin alterna entre pin y unpin', () => {
    const { result } = renderHook(() => usePinnedItems(KEY))
    act(() => result.current.togglePin('a'))
    expect(result.current.pinned).toEqual(['a'])
    act(() => result.current.togglePin('a'))
    expect(result.current.pinned).toEqual([])
  })

  it('clear vacia la lista', () => {
    const { result } = renderHook(() => usePinnedItems(KEY))
    act(() => {
      result.current.pin('a')
      result.current.pin('b')
    })
    act(() => result.current.clear())
    expect(result.current.pinned).toEqual([])
  })

  it('persiste entre renders', () => {
    const first = renderHook(() => usePinnedItems(KEY))
    act(() => first.result.current.pin('x'))
    first.unmount()
    const second = renderHook(() => usePinnedItems(KEY))
    expect(second.result.current.pinned).toEqual(['x'])
  })

  it('ignora storage corrupto', () => {
    window.localStorage.setItem(KEY, 'not json{')
    const { result } = renderHook(() => usePinnedItems(KEY))
    expect(result.current.pinned).toEqual([])
  })

  it('filtra valores no-string del storage', () => {
    window.localStorage.setItem(KEY, JSON.stringify(['a', 7, 'b', null, 'c']))
    const { result } = renderHook(() => usePinnedItems(KEY))
    expect(result.current.pinned).toEqual(['a', 'b', 'c'])
  })

  it('trunca al maxItems al cargar del storage', () => {
    window.localStorage.setItem(KEY, JSON.stringify(['a', 'b', 'c', 'd', 'e']))
    const { result } = renderHook(() => usePinnedItems(KEY, { maxItems: 2 }))
    expect(result.current.pinned).toEqual(['a', 'b'])
  })

  it('sincroniza entre tabs via storage event', () => {
    const { result } = renderHook(() => usePinnedItems(KEY))
    act(() => {
      window.localStorage.setItem(KEY, JSON.stringify(['z']))
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    })
    expect(result.current.pinned).toEqual(['z'])
  })

  it('togglePin respeta maxItems al agregar nuevo (descarta el mas viejo)', () => {
    const { result } = renderHook(() => usePinnedItems(KEY, { maxItems: 2 }))
    act(() => {
      result.current.pin('a')
      result.current.pin('b')
      result.current.togglePin('c')
    })
    // El nuevo 'c' va al frente; 'b' (mas reciente previo) sobrevive; 'a' se descarta.
    expect(result.current.pinned).toEqual(['c', 'b'])
  })
})
