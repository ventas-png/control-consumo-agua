import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { hojaEstilosMarca, BRAND_CSS_VARS, ACCENT_CSS_VARS, BRANDING_STYLE_ID } from '../../../lib/branding'

// plat:P20 — BrandingApplier inyecta/quita el <style> de marca (primario + acento,
// tema claro y oscuro). Mockeamos el hook de dominio para no tocar Supabase.
const state = vi.hoisted(() => ({
  primaryColor: null as string | null,
  accentColor: null as string | null,
}))
vi.mock('../../../domain/branding/queries', () => ({
  useBrandingQuery: () => ({ data: { company_id: 'c1', primary_color: state.primaryColor, accent_color: state.accentColor } }),
}))

import { BrandingApplier } from '../BrandingApplier'

const hoja = () => document.getElementById(BRANDING_STYLE_ID)

afterEach(() => {
  cleanup()
  hoja()?.remove()
})

describe('BrandingApplier', () => {
  it('con color primario, inyecta la hoja de marca en <head>', () => {
    state.primaryColor = '#ff0000'
    state.accentColor = null
    render(<BrandingApplier companyId="c1" />)
    const el = hoja()
    expect(el?.tagName).toBe('STYLE')
    expect(el?.parentElement).toBe(document.head)
    expect(el?.textContent).toBe(hojaEstilosMarca('#ff0000', null))
  })

  it('con color de acento, la hoja incluye --at-accent', () => {
    state.primaryColor = null
    state.accentColor = '#00ff00'
    render(<BrandingApplier companyId="c1" />)
    expect(hoja()?.textContent).toBe(hojaEstilosMarca(null, '#00ff00'))
    expect(hoja()?.textContent).toContain('--at-accent: #00ff00;')
  })

  it('NO aplica las vars inline en <html> (inline ganaba al override dark)', () => {
    state.primaryColor = '#ff0000'
    state.accentColor = '#00ff00'
    render(<BrandingApplier companyId="c1" />)
    for (const k of [...BRAND_CSS_VARS, ...ACCENT_CSS_VARS]) {
      expect(document.documentElement.style.getPropertyValue(k)).toBe('')
    }
  })

  it('al cambiar el color, reutiliza el mismo <style> (sin duplicar)', () => {
    state.primaryColor = '#ff0000'
    state.accentColor = null
    const { rerender } = render(<BrandingApplier companyId="c1" />)
    state.primaryColor = '#0033cc'
    rerender(<BrandingApplier companyId="c1" />)
    expect(document.querySelectorAll(`#${BRANDING_STYLE_ID}`)).toHaveLength(1)
    expect(hoja()?.textContent).toBe(hojaEstilosMarca('#0033cc', null))
  })

  it('sin colores (null), quita la hoja → defaults de la hoja base', () => {
    state.primaryColor = '#ff0000'
    state.accentColor = null
    const { rerender } = render(<BrandingApplier companyId="c1" />)
    expect(hoja()).not.toBeNull()
    state.primaryColor = null
    rerender(<BrandingApplier companyId="c1" />)
    expect(hoja()).toBeNull()
    expect(document.documentElement.style.getPropertyValue('--at-primary')).toBe('')
  })
})
