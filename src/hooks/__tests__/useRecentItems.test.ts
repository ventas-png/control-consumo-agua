import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRecentItems } from '../useRecentItems'

const KEY = 'test:recents'

beforeEach(() => {
  window.localStorage.clear()
})

describe('useRecentItems', () => {
  it('inicia vacio cuando no hay storage previo', () => {
    const { result } = renderHook(() => useRecentItems(KEY))
    expect(result.current.recent).toEqual([])
  })

  it('push agrega al frente', () => {
    const { result } = renderHook(() => useRecentItems(KEY))
    act(() => result.current.push('a'))
    act(() => result.current.push('b'))
    expect(result.current.recent).toEqual(['b', 'a'])
  })

  it('push de id existente lo promueve al frente sin duplicar', () => {
    const { result } = renderHook(() => useRecentItems(KEY))
    act(() => result.current.push('a'))
    act(() => result.current.push('b'))
    act(() => result.current.push('c'))
    act(() => result.current.push('a'))
    expect(result.current.recent).toEqual(['a', 'c', 'b'])
  })

  it('respeta maxItems descartando los mas viejos', () => {
    const { result } = renderHook(() => useRecentItems(KEY, { maxItems: 3 }))
    act(() => {
      result.current.push('a')
      result.current.push('b')
      result.current.push('c')
      result.current.push('d')
    })
    expect(result.current.recent).toEqual(['d', 'c', 'b'])
  })

  it('persiste en localStorage entre renders', () => {
    const first = renderHook(() => useRecentItems(KEY))
    act(() => first.result.current.push('x'))
    first.unmount()
    const second = renderHook(() => useRecentItems(KEY))
    expect(second.result.current.recent).toEqual(['x'])
  })

  it('remove quita un id', () => {
    const { result } = renderHook(() => useRecentItems(KEY))
    act(() => {
      result.current.push('a')
      result.current.push('b')
    })
    act(() => result.current.remove('a'))
    expect(result.current.recent).toEqual(['b'])
  })

  it('clear vacia la lista', () => {
    const { result } = renderHook(() => useRecentItems(KEY))
    act(() => {
      result.current.push('a')
      result.current.push('b')
    })
    act(() => result.current.clear())
    expect(result.current.recent).toEqual([])
  })

  it('ignora storage corrupto', () => {
    window.localStorage.setItem(KEY, 'not json {')
    const { result } = renderHook(() => useRecentItems(KEY))
    expect(result.current.recent).toEqual([])
  })

  it('ignora storage con tipo incorrecto', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ not: 'an array' }))
    const { result } = renderHook(() => useRecentItems(KEY))
    expect(result.current.recent).toEqual([])
  })

  it('filtra valores no-string del storage', () => {
    window.localStorage.setItem(KEY, JSON.stringify(['a', 42, 'b', null, 'c']))
    const { result } = renderHook(() => useRecentItems(KEY))
    expect(result.current.recent).toEqual(['a', 'b', 'c'])
  })

  it('trunca al maxItems al cargar de storage', () => {
    window.localStorage.setItem(KEY, JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f']))
    const { result } = renderHook(() => useRecentItems(KEY, { maxItems: 3 }))
    expect(result.current.recent).toEqual(['a', 'b', 'c'])
  })

  it('sincroniza entre tabs via storage event', () => {
    const { result } = renderHook(() => useRecentItems(KEY))
    act(() => {
      window.localStorage.setItem(KEY, JSON.stringify(['z', 'y']))
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    })
    expect(result.current.recent).toEqual(['z', 'y'])
  })

  it('ignora storage events de otras keys', () => {
    const { result } = renderHook(() => useRecentItems(KEY))
    act(() => result.current.push('a'))
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'other:key' }))
    })
    expect(result.current.recent).toEqual(['a'])
  })
})
