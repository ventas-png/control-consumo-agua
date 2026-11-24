import { describe, it, expect, vi } from 'vitest'

vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: vi.fn() }))

const { debeAplazarRecarga } = await import('../PwaUpdatePrompt')

describe('recarga automática por versión nueva', () => {
  it('se aplaza en Nueva Lectura o con una ruta a medias; si no, recarga', () => {
    expect(debeAplazarRecarga('/lecturas', false)).toBe(true)
    expect(debeAplazarRecarga('/cobros', true)).toBe(true)
    expect(debeAplazarRecarga('/cobros', false)).toBe(false)
  })
})
