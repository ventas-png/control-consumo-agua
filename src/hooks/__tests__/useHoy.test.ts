// Contrato de useHoy: identidad ESTABLE dentro del día (para poder declararlo
// como dependencia de un memo/efecto sin recalcularlo en cada render) y cambio
// EXACTO al cruzar la medianoche local (para que una pantalla abierta de noche
// no se quede con la fecha de ayer). Con temporizadores falsos: el cambio de
// día es justo lo que ninguna prueba cubría antes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useHoy, useHoyDate, useHoyLocalISO } from '../useHoy'

beforeEach(() => {
  vi.useFakeTimers()
  // 2026-08-18 a las 14:30 LOCAL (el runner corre en UTC, pero la aserción se
  // hace siempre contra componentes locales, así que no depende del huso).
  vi.setSystemTime(new Date(2026, 7, 18, 14, 30, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useHoyLocalISO', () => {
  it('devuelve la fecha LOCAL de hoy', () => {
    const { result } = renderHook(() => useHoyLocalISO())
    expect(result.current).toBe('2026-08-18')
  })

  it('conserva la MISMA identidad entre renders del mismo día', () => {
    const { result, rerender } = renderHook(() => useHoy())
    const primero = result.current
    rerender()
    rerender()
    expect(result.current).toBe(primero)
  })

  it('no cambia al avanzar el reloj dentro del mismo día', () => {
    const { result } = renderHook(() => useHoy())
    const primero = result.current
    act(() => { vi.advanceTimersByTime(9 * 3600 * 1000) })  // 23:30, aún día 18
    expect(result.current).toBe(primero)
    expect(result.current.hoyISO).toBe('2026-08-18')
  })

  it('cambia al cruzar la medianoche LOCAL', () => {
    const { result } = renderHook(() => useHoyLocalISO())
    expect(result.current).toBe('2026-08-18')

    // 9h30m hasta las 00:00 del 19 + margen.
    act(() => { vi.advanceTimersByTime(9.5 * 3600 * 1000 + 1000) })

    expect(result.current).toBe('2026-08-19')
  })

  it('sigue cambiando en días sucesivos (el temporizador se reprograma)', () => {
    const { result } = renderHook(() => useHoyLocalISO())
    act(() => { vi.advanceTimersByTime(9.5 * 3600 * 1000 + 1000) })
    expect(result.current).toBe('2026-08-19')
    act(() => { vi.advanceTimersByTime(24 * 3600 * 1000) })
    expect(result.current).toBe('2026-08-20')
  })

  it('no re-renderiza infinitamente: un solo cambio por día', () => {
    let renders = 0
    renderHook(() => { renders++; return useHoyLocalISO() })
    const base = renders
    act(() => { vi.advanceTimersByTime(9.5 * 3600 * 1000 + 1000) })
    // Exactamente un render extra por el cambio de día.
    expect(renders).toBe(base + 1)
    act(() => { vi.advanceTimersByTime(3 * 3600 * 1000) })
    expect(renders).toBe(base + 1)
  })

  it('limpia el temporizador al desmontar', () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    const { unmount } = renderHook(() => useHoyLocalISO())
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unmount()
    expect(clear).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('useHoyDate', () => {
  it('mantiene la MISMA referencia dentro del día', () => {
    const { result, rerender } = renderHook(() => useHoyDate())
    const primero = result.current
    rerender()
    expect(result.current).toBe(primero)
    act(() => { vi.advanceTimersByTime(3600 * 1000) })
    expect(result.current).toBe(primero)
  })

  it('captura un Date NUEVO al cruzar la medianoche', () => {
    const { result } = renderHook(() => useHoyDate())
    const primero = result.current
    expect(primero.getDate()).toBe(18)

    act(() => { vi.advanceTimersByTime(9.5 * 3600 * 1000 + 1000) })

    expect(result.current).not.toBe(primero)
    expect(result.current.getDate()).toBe(19)
  })
})
