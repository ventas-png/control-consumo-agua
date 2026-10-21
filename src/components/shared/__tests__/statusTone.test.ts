import { describe, expect, it } from 'vitest'
import { tint } from '../statusTone'

describe('tint', () => {
  it('mezcla una variable CSS con transparente al porcentaje pedido', () => {
    // El viejo `color + '20'` daba `var(--at-success)20`, que no es un color.
    expect(tint('var(--at-success)', 12)).toBe('color-mix(in srgb, var(--at-success) 12%, transparent)')
  })

  it('usa 14% por defecto', () => {
    expect(tint('var(--at-info)')).toBe('color-mix(in srgb, var(--at-info) 14%, transparent)')
  })

  it('acepta hex y variables con respaldo', () => {
    expect(tint('#10b981', 13)).toBe('color-mix(in srgb, #10b981 13%, transparent)')
    expect(tint('var(--at-success-strong, var(--at-accent-2))', 80))
      .toBe('color-mix(in srgb, var(--at-success-strong, var(--at-accent-2)) 80%, transparent)')
  })
})
