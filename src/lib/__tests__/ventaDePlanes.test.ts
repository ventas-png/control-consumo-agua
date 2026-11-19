// La regla central: el plan (suscripción digital) solo se vende en la web. En la
// app nativa, App Store 3.1.1 y la política de pagos de Google Play lo prohíben.
import { describe, it, expect, vi } from 'vitest'

const capacitor = vi.hoisted(() => ({
  isNativePlatform: vi.fn<() => boolean>(),
  getPlatform: vi.fn<() => string>(),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: capacitor }))

import { mostrarVentaDePlanes } from '../ventaDePlanes'

describe('mostrarVentaDePlanes', () => {
  it.each([
    ['web', true],
    ['ios', false],
    ['android', false],
  ] as const)('%s → %s', (plataforma, esperado) => {
    capacitor.isNativePlatform.mockReturnValue(plataforma !== 'web')
    capacitor.getPlatform.mockReturnValue(plataforma)
    expect(mostrarVentaDePlanes()).toBe(esperado)
  })
})
