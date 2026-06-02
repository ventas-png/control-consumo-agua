import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBulkSelection } from '../useBulkSelection'

interface Item { id: string; name: string }

const ITEMS: Item[] = [
  { id: 'a', name: 'Ana' },
  { id: 'b', name: 'Beto' },
  { id: 'c', name: 'Cesar' },
]

const getId = (i: Item) => i.id

describe('useBulkSelection', () => {
  it('estado inicial vacío', () => {
    const { result } = renderHook(() => useBulkSelection(ITEMS, getId))
    expect(result.current.count).toBe(0)
    expect(result.current.hasSelection).toBe(false)
    expect(result.current.isAllSelected).toBe(false)
    expect(result.current.selectedItems).toEqual([])
  })

  it('toggle agrega y quita ids', () => {
    const { result } = renderHook(() => useBulkSelection(ITEMS, getId))
    act(() => result.current.toggle('a'))
    expect(result.current.count).toBe(1)
    expect(result.current.isSelected('a')).toBe(true)
    expect(result.current.selectedItems.map(i => i.id)).toEqual(['a'])

    act(() => result.current.toggle('a'))
    expect(result.current.count).toBe(0)
    expect(result.current.isSelected('a')).toBe(false)
  })

  it('toggleAll selecciona todos los visibles', () => {
    const { result } = renderHook(() => useBulkSelection(ITEMS, getId))
    act(() => result.current.toggleAll())
    expect(result.current.count).toBe(3)
    expect(result.current.isAllSelected).toBe(true)
  })

  it('toggleAll con todos seleccionados → limpia los visibles', () => {
    const { result } = renderHook(() => useBulkSelection(ITEMS, getId))
    act(() => result.current.toggleAll())
    act(() => result.current.toggleAll())
    expect(result.current.count).toBe(0)
  })

  it('toggleAll preserva selecciones de otras paginas', () => {
    // Simula scenario: usuario seleccionó "x" en pagina 1, ahora ve pagina 2
    const { result, rerender } = renderHook(
      ({ items }) => useBulkSelection(items, getId),
      { initialProps: { items: [{ id: 'x', name: 'X' }] } },
    )
    act(() => result.current.toggle('x'))
    expect(result.current.count).toBe(1)

    // Cambia a otra pagina con items distintos
    rerender({ items: [{ id: 'y', name: 'Y' }, { id: 'z', name: 'Z' }] })
    expect(result.current.count).toBe(1) // 'x' sigue seleccionado

    // Toggle all en la nueva pagina → agrega y/z, mantiene x
    act(() => result.current.toggleAll())
    expect(result.current.count).toBe(3)
    expect(result.current.isSelected('x')).toBe(true)

    // Toggle all otra vez → quita y/z, mantiene x
    act(() => result.current.toggleAll())
    expect(result.current.count).toBe(1)
    expect(result.current.isSelected('x')).toBe(true)
  })

  it('selectMany agrega ids sin quitar otros', () => {
    const { result } = renderHook(() => useBulkSelection(ITEMS, getId))
    act(() => result.current.toggle('a'))
    act(() => result.current.selectMany(['b', 'c']))
    expect(result.current.count).toBe(3)
  })

  it('invert invierte solo los visibles', () => {
    const { result } = renderHook(() => useBulkSelection(ITEMS, getId))
    act(() => result.current.toggle('a'))
    act(() => result.current.invert())
    // a queda fuera, b y c agregados
    expect(result.current.isSelected('a')).toBe(false)
    expect(result.current.isSelected('b')).toBe(true)
    expect(result.current.isSelected('c')).toBe(true)
  })

  it('clear vacía el set', () => {
    const { result } = renderHook(() => useBulkSelection(ITEMS, getId))
    act(() => result.current.toggleAll())
    act(() => result.current.clear())
    expect(result.current.count).toBe(0)
  })

  it('isAllSelected false si items.length === 0 (no es vacío todo seleccionado)', () => {
    const { result } = renderHook(() => useBulkSelection([] as Item[], getId))
    expect(result.current.isAllSelected).toBe(false)
  })

  it('selectedItems se actualiza cuando cambia el set', () => {
    const { result } = renderHook(() => useBulkSelection(ITEMS, getId))
    act(() => result.current.toggle('b'))
    act(() => result.current.toggle('c'))
    expect(result.current.selectedItems.map(i => i.name).sort()).toEqual(['Beto', 'Cesar'])
  })
})
