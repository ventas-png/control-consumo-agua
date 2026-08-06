import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../lib/supabase', () => ({ db: {}, supabase: {} }))

import { bandaRiesgo } from '../morosidad'

describe('bandaRiesgo', () => {
  it('clasifica en alto/medio/bajo por umbrales', () => {
    expect(bandaRiesgo(100)).toBe('alto')
    expect(bandaRiesgo(66)).toBe('alto')
    expect(bandaRiesgo(65)).toBe('medio')
    expect(bandaRiesgo(33)).toBe('medio')
    expect(bandaRiesgo(32)).toBe('bajo')
    expect(bandaRiesgo(0)).toBe('bajo')
  })
})
