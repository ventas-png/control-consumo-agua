import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// plat:P18 — useFormato liga los formateadores a las preferencias del usuario.
// Mockeamos la sesión y la query de preferencias para no tocar contexto/red.
const state = vi.hoisted(() => ({
  prefs: null as null | { locale: string; timezone: string; currency: string },
}))
vi.mock('../../components/shared/SessionContext', () => ({
  useSession: () => ({ user_id: 'u1' }),
}))
vi.mock('../../domain/preferencias/queries', () => ({
  useMisPreferenciasQuery: () => ({ data: state.prefs }),
}))

import { useFormato } from '../useFormato'

describe('useFormato', () => {
  it('sin preferencias guardadas → usa los defaults (es / America/Guatemala / GTQ)', () => {
    state.prefs = null
    const { result } = renderHook(() => useFormato())
    expect(result.current.prefs).toEqual({ locale: 'es', timezone: 'America/Guatemala', currency: 'GTQ' })
    expect(result.current.formatFechaHora('2026-06-04T18:00:00Z').length).toBeGreaterThan(0)
  })

  it('respeta la zona horaria guardada (cambia el resultado para el mismo instante)', () => {
    const iso = '2026-06-04T18:00:00Z'
    state.prefs = { locale: 'es', timezone: 'UTC', currency: 'GTQ' }
    const utc = renderHook(() => useFormato()).result.current.formatFechaHora(iso)
    state.prefs = { locale: 'es', timezone: 'America/Guatemala', currency: 'GTQ' }
    const gt = renderHook(() => useFormato()).result.current.formatFechaHora(iso)
    expect(utc).not.toBe(gt)
  })

  it('formatMoneda devuelve un string con los dígitos del monto', () => {
    state.prefs = { locale: 'es', timezone: 'UTC', currency: 'USD' }
    const { result } = renderHook(() => useFormato())
    expect(result.current.formatMoneda(1234.5)).toMatch(/234/)
  })
})
