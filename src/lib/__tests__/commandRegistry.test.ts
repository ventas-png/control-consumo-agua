import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { registerCommands, useRegisteredCommands, __resetCommandRegistry } from '../commandRegistry'

beforeEach(() => {
  __resetCommandRegistry()
})

describe('commandRegistry', () => {
  it('useRegisteredCommands inicia vacio', () => {
    const { result } = renderHook(() => useRegisteredCommands())
    expect(result.current).toEqual([])
  })

  it('registerCommands agrega items y dispara update reactivo', () => {
    const { result } = renderHook(() => useRegisteredCommands())
    act(() => {
      registerCommands([
        { id: 'a', label: 'A', onSelect: () => {} },
        { id: 'b', label: 'B', onSelect: () => {} },
      ])
    })
    expect(result.current).toHaveLength(2)
    expect(result.current.map(c => c.id)).toEqual(['a', 'b'])
  })

  it('cleanup retorna funcion que quita SOLO los registrados por ese call', () => {
    const { result } = renderHook(() => useRegisteredCommands())
    let cleanup1: () => void = () => {}
    act(() => {
      cleanup1 = registerCommands([{ id: 'a', label: 'A', onSelect: () => {} }])
    })
    act(() => {
      registerCommands([{ id: 'b', label: 'B', onSelect: () => {} }])
    })
    expect(result.current).toHaveLength(2)

    act(() => { cleanup1() })
    expect(result.current).toHaveLength(1)
    expect(result.current[0].id).toBe('b')
  })

  it('re-registrar con mismo id reemplaza el item previo (no duplica)', () => {
    const { result } = renderHook(() => useRegisteredCommands())
    act(() => {
      registerCommands([{ id: 'x', label: 'First', onSelect: () => {} }])
    })
    act(() => {
      registerCommands([{ id: 'x', label: 'Second', onSelect: () => {} }])
    })
    expect(result.current).toHaveLength(1)
    expect(result.current[0].label).toBe('Second')
  })

  it('llamar con array vacio retorna noop cleanup', () => {
    const cleanup = registerCommands([])
    expect(typeof cleanup).toBe('function')
    // No debe lanzar
    expect(() => cleanup()).not.toThrow()
  })

  it('multiples consumidores reciben el mismo snapshot', () => {
    const a = renderHook(() => useRegisteredCommands())
    const b = renderHook(() => useRegisteredCommands())
    act(() => {
      registerCommands([{ id: 'z', label: 'Z', onSelect: () => {} }])
    })
    expect(a.result.current).toHaveLength(1)
    expect(b.result.current).toHaveLength(1)
  })
})
