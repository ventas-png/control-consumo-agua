import { describe, it, expect, vi, beforeEach } from 'vitest'
import { trackSLOBreach, measureSLO, reportSLOError, SLO_CATALOG } from '../slo'

vi.mock('../monitoring', () => ({
  captureException: vi.fn(),
}))

vi.mock('../analytics', () => ({
  track: vi.fn(),
}))

vi.mock('../logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { captureException } from '../monitoring'
import { track } from '../analytics'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SLO catalog', () => {
  it('todos los entries tienen type valido', () => {
    const validTypes = ['latency', 'error_rate', 'availability']
    for (const def of Object.values(SLO_CATALOG)) {
      expect(validTypes).toContain(def.type)
    }
  })

  it('latency entries tienen target_p95_ms positivo', () => {
    for (const [, def] of Object.entries(SLO_CATALOG)) {
      if (def.type === 'latency') {
        expect((def as { target_p95_ms: number }).target_p95_ms).toBeGreaterThan(0)
      }
    }
  })

  it('error_rate entries tienen target_pct <= 100', () => {
    for (const [, def] of Object.entries(SLO_CATALOG)) {
      if (def.type === 'error_rate') {
        const pct = (def as { target_pct: number }).target_pct
        expect(pct).toBeGreaterThanOrEqual(0)
        expect(pct).toBeLessThanOrEqual(100)
      }
    }
  })
})

describe('trackSLOBreach', () => {
  it('emite Sentry + PostHog event con tags', () => {
    trackSLOBreach('login.complete', {
      measured: 2500,
      target: 2000,
      severity: 'critical',
      extra: { user_id: 'u-1' },
    })
    expect(captureException).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('slo.breach', expect.objectContaining({
      slo_key: 'login.complete',
      slo_type: 'latency',
      slo_severity: 'critical',
      target: 2000,
      measured: 2500,
      user_id: 'u-1',
    }))
  })
})

describe('measureSLO — latency', () => {
  it('ejecuta la operación y retorna su resultado', async () => {
    const result = await measureSLO('modal.open', async () => 'done')
    expect(result).toBe('done')
  })

  it('NO emite breach si el tiempo está dentro del target', async () => {
    await measureSLO('modal.open', async () => 'fast') // muy rápido, < 200ms
    expect(captureException).not.toHaveBeenCalled()
    // Pero siempre emite latency event para el histograma.
    expect(track).toHaveBeenCalledWith('slo.latency', expect.objectContaining({
      slo_key: 'modal.open',
      breached: false,
    }))
  })

  it('emite breach si el tiempo excede el target', async () => {
    // Simula 50ms de espera contra un target de 1ms para forzar breach.
    // Necesitamos mockear performance.now()
    const origNow = performance.now.bind(performance)
    let count = 0
    vi.spyOn(performance, 'now').mockImplementation(() => {
      count++
      return count === 1 ? 0 : 1000 // primera llamada=0, segunda=1000ms
    })

    try {
      await measureSLO('modal.open', async () => 'slow') // 1000ms > 200ms target
      expect(captureException).toHaveBeenCalledTimes(1)
      expect(track).toHaveBeenCalledWith('slo.breach', expect.any(Object))
      expect(track).toHaveBeenCalledWith('slo.latency', expect.objectContaining({
        breached: true,
      }))
    } finally {
      performance.now = origNow
    }
  })

  it('propaga errors de la operación', async () => {
    await expect(
      measureSLO('modal.open', async () => { throw new Error('boom') })
    ).rejects.toThrow('boom')
    // Y trackea como errored.
    expect(track).toHaveBeenCalledWith('slo.latency', expect.objectContaining({
      errored: true,
    }))
  })
})

describe('reportSLOError', () => {
  it('emite event posthog para error_rate', () => {
    reportSLOError('login.error_rate', { reason: 'invalid_credentials' })
    expect(track).toHaveBeenCalledWith('slo.error', expect.objectContaining({
      slo_key: 'login.error_rate',
      reason: 'invalid_credentials',
    }))
  })
})
