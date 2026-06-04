import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { derivarVariablesMarca, BRAND_CSS_VARS } from '../../../lib/branding'

// plat:P20 — BrandingApplier setea/limpia las CSS vars de marca en :root.
// Mockeamos el hook de dominio para no tocar Supabase.
const state = vi.hoisted(() => ({ primaryColor: null as string | null }))
vi.mock('../../../domain/branding/queries', () => ({
  useBrandingQuery: () => ({ data: { company_id: 'c1', primary_color: state.primaryColor } }),
}))

import { BrandingApplier } from '../BrandingApplier'

afterEach(() => {
  cleanup()
  for (const k of BRAND_CSS_VARS) document.documentElement.style.removeProperty(k)
})

describe('BrandingApplier', () => {
  it('con color de marca, aplica --at-primary en :root', () => {
    state.primaryColor = '#ff0000'
    render(<BrandingApplier companyId="c1" />)
    expect(document.documentElement.style.getPropertyValue('--at-primary'))
      .toBe(derivarVariablesMarca('#ff0000').primary)
  })

  it('sin color de marca (null), no deja override en --at-primary', () => {
    state.primaryColor = null
    render(<BrandingApplier companyId="c1" />)
    expect(document.documentElement.style.getPropertyValue('--at-primary')).toBe('')
  })
})
