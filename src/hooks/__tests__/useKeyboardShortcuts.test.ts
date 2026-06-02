import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useKeyboardShortcuts, type ShortcutBinding } from '../useKeyboardShortcuts'

function fireKey(key: string, target: EventTarget = window) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  // jsdom no respeta `e.target` cuando se dispara via dispatchEvent en window;
  // forzamos via window pero el listener real lee e.target del DOM si existe.
  target.dispatchEvent(e)
  return e
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useKeyboardShortcuts', () => {
  it('dispara handler en single-key shortcut', () => {
    const handler = vi.fn()
    const bindings: ShortcutBinding[] = [
      { sequence: '?', handler, description: 'help' },
    ]
    renderHook(() => useKeyboardShortcuts(bindings))
    fireKey('?')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('dispara handler en leader sequence "g c"', () => {
    const handler = vi.fn()
    const bindings: ShortcutBinding[] = [
      { sequence: 'g c', handler, description: 'go clientes' },
    ]
    renderHook(() => useKeyboardShortcuts(bindings))
    fireKey('g')
    fireKey('c')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('NO dispara si la 2da tecla no matchea', () => {
    const handler = vi.fn()
    const bindings: ShortcutBinding[] = [
      { sequence: 'g c', handler, description: 'go clientes' },
    ]
    renderHook(() => useKeyboardShortcuts(bindings))
    fireKey('g')
    fireKey('x') // tecla incorrecta
    expect(handler).not.toHaveBeenCalled()
  })

  it('leader expira tras timeout y no dispara', () => {
    const handler = vi.fn()
    const bindings: ShortcutBinding[] = [
      { sequence: 'g c', handler, description: 'go clientes' },
    ]
    renderHook(() => useKeyboardShortcuts(bindings))
    fireKey('g')
    act(() => { vi.advanceTimersByTime(1500) }) // > LEADER_TIMEOUT_MS
    fireKey('c')
    expect(handler).not.toHaveBeenCalled()
  })

  it('NO dispara cuando foco esta en INPUT', () => {
    const handler = vi.fn()
    const bindings: ShortcutBinding[] = [
      { sequence: '?', handler, description: 'help' },
    ]
    renderHook(() => useKeyboardShortcuts(bindings))

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    const e = new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true })
    input.dispatchEvent(e)

    expect(handler).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('NO dispara cuando hay modifier (Cmd/Ctrl)', () => {
    const handler = vi.fn()
    const bindings: ShortcutBinding[] = [
      { sequence: 'k', handler, description: 'palette' },
    ]
    renderHook(() => useKeyboardShortcuts(bindings))

    const e = new KeyboardEvent('keydown', {
      key: 'k', metaKey: true, bubbles: true, cancelable: true,
    })
    window.dispatchEvent(e)

    expect(handler).not.toHaveBeenCalled()
  })

  it('match multiple bindings independientes', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()
    const bindings: ShortcutBinding[] = [
      { sequence: 'g c', handler: handler1, description: 'clientes' },
      { sequence: 'g d', handler: handler2, description: 'dashboard' },
    ]
    renderHook(() => useKeyboardShortcuts(bindings))
    fireKey('g'); fireKey('c')
    fireKey('g'); fireKey('d')
    expect(handler1).toHaveBeenCalledTimes(1)
    expect(handler2).toHaveBeenCalledTimes(1)
  })

  it('llamar preventDefault en eventos matchados', () => {
    const handler = vi.fn()
    const bindings: ShortcutBinding[] = [
      { sequence: '?', handler, description: 'help' },
    ]
    renderHook(() => useKeyboardShortcuts(bindings))

    const e = new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true })
    const spy = vi.spyOn(e, 'preventDefault')
    window.dispatchEvent(e)
    expect(spy).toHaveBeenCalled()
  })

  it('actualiza bindings sin re-attach del listener (ref interno)', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()
    const { rerender } = renderHook(
      ({ b }: { b: ShortcutBinding[] }) => useKeyboardShortcuts(b),
      { initialProps: { b: [{ sequence: '?', handler: handler1, description: 'h1' }] } },
    )
    fireKey('?')
    expect(handler1).toHaveBeenCalledTimes(1)

    rerender({ b: [{ sequence: '?', handler: handler2, description: 'h2' }] })
    fireKey('?')
    expect(handler2).toHaveBeenCalledTimes(1)
    // handler1 sigue en 1 (no re-disparado)
    expect(handler1).toHaveBeenCalledTimes(1)
  })

  it('cleanup quita el listener al desmontar', () => {
    const handler = vi.fn()
    const bindings: ShortcutBinding[] = [
      { sequence: '?', handler, description: 'help' },
    ]
    const { unmount } = renderHook(() => useKeyboardShortcuts(bindings))
    unmount()
    fireKey('?')
    expect(handler).not.toHaveBeenCalled()
  })
})
