import { describe, it, expect } from 'vitest'
import { track, identify, resetAnalytics } from '../analytics'

describe('analytics wrapper', () => {
  it('no-ops safely when no VITE_POSTHOG_KEY is configured', () => {
    expect(() => {
      identify('user-1', { company_id: 'c1', role: 'admin' })
      track('condominios_tab_viewed', { tab: 'cuotas', section: 'finanzas' })
      resetAnalytics()
    }).not.toThrow()
  })
})
