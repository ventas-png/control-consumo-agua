import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { derivarVariablesMarca, normalizarColorHex, BRAND_CSS_VARS, ACCENT_CSS_VARS } from '../../../lib/branding'

// plat:P20 — BrandingApplier setea/limpia las CSS vars de marca (primario + acento)
// en :root. Mockeamos el hook de dominio para no tocar Supabase.
const state = vi.hoisted(() => ({
  primaryColor: null as string | null,
  accentColor: null as string | null,
}))
vi.mock('../../../domain/branding/queries', () => ({
  useBrandingQuery: () => ({ data: { company_id: 'c1', primary_color: state.primaryColor, accent_color: state.accentColor } }),
}))

import { BrandingApplier } from '../BrandingApplier'

afterEach(() => {
  cleanup()
  for (const k of [...BRAND_CSS_VARS, ...ACCENT_CSS_VARS]) document.documentElement.style.removeProperty(k)
})

describe('BrandingApplier', () => {
  it('con color primario, aplica --at-primary en :root', () => {
    state.primaryColor = '#ff0000'
    state.accentColor = null
    render(<BrandingApplier companyId="c1" />)
    expect(document.documentElement.style.getPropertyValue('--at-primary'))
      .toBe(derivarVariablesMarca('#ff0000').primary)
  })

  it('con color de acento, aplica --at-accent en :root', () => {
    state.primaryColor = null
    state.accentColor = '#00ff00'
    render(<BrandingApplier companyId="c1" />)
    expect(document.documentElement.style.getPropertyValue('--at-accent'))
      .toBe(normalizarColorHex('#00ff00'))
  })

  it('sin colores (null), no deja override en --at-primary ni --at-accent', () => {
    state.primaryColor = null
    state.accentColor = null
    render(<BrandingApplier companyId="c1" />)
    expect(document.documentElement.style.getPropertyValue('--at-primary')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--at-accent')).toBe('')
  })
})
