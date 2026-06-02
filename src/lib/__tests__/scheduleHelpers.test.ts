import { describe, it, expect } from 'vitest'
import { nextRunFor, formatNextRun } from '../scheduleHelpers'

describe('nextRunFor', () => {
  it('returns null para schedule manual', () => {
    expect(nextRunFor('manual', null)).toBeNull()
    expect(nextRunFor('manual', '2026-06-01T09:00:00Z')).toBeNull()
  })

  describe('monthly_day1', () => {
    it('si hoy es día 1 antes de las 9 UTC → hoy mismo a las 9', () => {
      const now = new Date('2026-06-01T07:00:00Z')
      const next = nextRunFor('monthly_day1', null, now)!
      expect(next.toISOString()).toBe('2026-06-01T09:00:00.000Z')
    })

    it('si hoy es día 1 después de las 9 UTC → próximo mes día 1', () => {
      const now = new Date('2026-06-01T10:00:00Z')
      const next = nextRunFor('monthly_day1', null, now)!
      expect(next.toISOString()).toBe('2026-07-01T09:00:00.000Z')
    })

    it('si hoy es día 15 → próximo mes día 1 a las 9', () => {
      const now = new Date('2026-06-15T12:00:00Z')
      const next = nextRunFor('monthly_day1', null, now)!
      expect(next.toISOString()).toBe('2026-07-01T09:00:00.000Z')
    })

    it('si ya corrio hoy → salta al próximo ciclo', () => {
      const now = new Date('2026-06-01T07:00:00Z')
      const lastRun = '2026-06-01T05:00:00Z'
      const next = nextRunFor('monthly_day1', lastRun, now)!
      // Hoy ya corrió, así que próximo es 1 julio
      expect(next.toISOString()).toBe('2026-07-01T09:00:00.000Z')
    })
  })

  describe('weekly_monday', () => {
    it('si hoy es lunes antes de 9 UTC → hoy a las 9', () => {
      const now = new Date('2026-06-01T07:00:00Z') // 2026-06-01 es lunes
      const next = nextRunFor('weekly_monday', null, now)!
      expect(next.toISOString()).toBe('2026-06-01T09:00:00.000Z')
    })

    it('si hoy es lunes después de 9 UTC → próximo lunes', () => {
      const now = new Date('2026-06-01T10:00:00Z')
      const next = nextRunFor('weekly_monday', null, now)!
      expect(next.toISOString()).toBe('2026-06-08T09:00:00.000Z')
    })

    it('si hoy es martes → próximo lunes en 6 días', () => {
      const now = new Date('2026-06-02T12:00:00Z')
      const next = nextRunFor('weekly_monday', null, now)!
      expect(next.toISOString()).toBe('2026-06-08T09:00:00.000Z')
    })

    it('si hoy es viernes → próximo lunes en 3 días', () => {
      const now = new Date('2026-06-05T12:00:00Z')
      const next = nextRunFor('weekly_monday', null, now)!
      expect(next.toISOString()).toBe('2026-06-08T09:00:00.000Z')
    })

    it('si hoy es domingo → mañana (lunes)', () => {
      const now = new Date('2026-06-07T12:00:00Z')
      const next = nextRunFor('weekly_monday', null, now)!
      expect(next.toISOString()).toBe('2026-06-08T09:00:00.000Z')
    })
  })
})

describe('formatNextRun', () => {
  it('"en X horas" cuando es dentro de 24h', () => {
    const now = new Date('2026-06-01T09:00:00Z')
    const future = new Date('2026-06-01T12:00:00Z')
    expect(formatNextRun(future, now)).toBe('en 3h')
  })

  it('"en menos de 1h" cuando es dentro de 1h', () => {
    const now = new Date('2026-06-01T09:00:00Z')
    const future = new Date('2026-06-01T09:30:00Z')
    expect(formatNextRun(future, now)).toBe('en menos de 1h')
  })

  it('"pendiente" si la fecha ya pasó', () => {
    const now = new Date('2026-06-01T12:00:00Z')
    const past = new Date('2026-06-01T09:00:00Z')
    expect(formatNextRun(past, now)).toBe('pendiente')
  })

  it('formato legible para fechas > 24h', () => {
    const now = new Date('2026-06-01T12:00:00Z')
    const future = new Date('2026-06-08T09:00:00Z')
    const result = formatNextRun(future, now)
    expect(result).toContain('UTC')
    expect(result).toContain('jun') // mes corto en español
  })
})
