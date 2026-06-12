import { describe, it, expect } from 'vitest'
import {
  moduleBadgeLabel,
  planCodeLabel,
  purgeEligibleAt,
  isPurgeEligible,
  formatUsdCents,
} from '../empresaHelpers'

describe('moduleBadgeLabel', () => {
  it('deriva la etiqueta de los flags de servicio', () => {
    expect(moduleBadgeLabel(true, true)).toBe('Agua + Condominios')
    expect(moduleBadgeLabel(true, false)).toBe('Agua')
    expect(moduleBadgeLabel(false, true)).toBe('Condominios')
    expect(moduleBadgeLabel(false, false)).toBe('Sin módulos')
  })
})

describe('planCodeLabel', () => {
  it('traduce los códigos de billing plan', () => {
    expect(planCodeLabel('agua_only')).toBe('Solo Agua')
    expect(planCodeLabel('condominios_only')).toBe('Solo Condominios')
    expect(planCodeLabel('bundle')).toBe('Bundle Completo')
    expect(planCodeLabel(null)).toBe('Sin suscripción')
  })

  it('devuelve el código tal cual si es desconocido (forward-compat)', () => {
    expect(planCodeLabel('nuevo_plan')).toBe('nuevo_plan')
  })
})

describe('purga con período de gracia', () => {
  it('sin suspensión no hay elegibilidad', () => {
    expect(purgeEligibleAt(null)).toBeNull()
    expect(isPurgeEligible(null)).toBe(false)
  })

  it('fechas inválidas no habilitan la purga', () => {
    expect(purgeEligibleAt('no-es-fecha')).toBeNull()
    expect(isPurgeEligible('no-es-fecha')).toBe(false)
  })

  it('antes de cumplir la gracia no es elegible; después sí', () => {
    const now = new Date('2026-06-12T00:00:00Z')
    const reciente = '2026-06-01T00:00:00Z' // 11 días suspendida
    const antigua = '2026-01-01T00:00:00Z'  // > 90 días suspendida
    expect(isPurgeEligible(reciente, 90, now)).toBe(false)
    expect(isPurgeEligible(antigua, 90, now)).toBe(true)
  })

  it('la fecha de elegibilidad es suspensión + graceDays', () => {
    const eligible = purgeEligibleAt('2026-01-01T00:00:00Z', 90)
    expect(eligible?.toISOString().slice(0, 10)).toBe('2026-04-01')
  })
})

describe('formatUsdCents', () => {
  it('formatea cents como USD con separador de miles', () => {
    expect(formatUsdCents(0)).toBe('$0.00')
    expect(formatUsdCents(1080)).toBe('$10.80')
    expect(formatUsdCents(123456)).toBe('$1,234.56')
  })
})
