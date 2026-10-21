import { describe, it, expect } from 'vitest'
import { dayKey, dayLabel, initials, tint } from '../conversationConstants'

describe('tint', () => {
  // `var(--at-info)` + '18' daba `var(--at-info)18`: CSS inválido, badge sin fondo.
  it('produce un color-mix válido a partir de una variable CSS', () => {
    expect(tint('var(--at-info)')).toBe('color-mix(in srgb, var(--at-info) 14%, transparent)')
    expect(tint('var(--at-danger)', 30)).toBe('color-mix(in srgb, var(--at-danger) 30%, transparent)')
  })
})

describe('initials', () => {
  it('toma la primera y la última palabra', () => {
    expect(initials('Carlos Augusto Garcia Castillo')).toBe('CC')
    expect(initials('santos')).toBe('S')
  })
  it('sin nombre devuelve un marcador', () => {
    expect(initials(null)).toBe('?')
    expect(initials('   ')).toBe('?')
  })
})

describe('dayLabel / dayKey', () => {
  const now = new Date(2026, 9, 21, 12, 0)
  it('Hoy y Ayer por día calendario, no por 24 h', () => {
    expect(dayLabel(new Date(2026, 9, 21, 0, 5).toISOString(), now)).toBe('Hoy')
    expect(dayLabel(new Date(2026, 9, 20, 23, 59).toISOString(), now)).toBe('Ayer')
  })
  it('más atrás, la fecha; con año solo si no es el actual', () => {
    expect(dayLabel(new Date(2026, 9, 14).toISOString(), now)).toMatch(/14/)
    expect(dayLabel(new Date(2026, 9, 14).toISOString(), now)).not.toMatch(/2026/)
    expect(dayLabel(new Date(2025, 9, 14).toISOString(), now)).toMatch(/2025/)
  })
  it('dayKey agrupa por día local', () => {
    expect(dayKey(new Date(2026, 9, 14, 1).toISOString())).toBe(dayKey(new Date(2026, 9, 14, 23).toISOString()))
    expect(dayKey(new Date(2026, 9, 14, 23).toISOString())).not.toBe(dayKey(new Date(2026, 9, 15, 0).toISOString()))
  })
})
