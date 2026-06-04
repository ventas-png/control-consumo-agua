import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// plat:P20 — CompanyBrandMark muestra el logo de la empresa (white-label) o cae
// al BrandLogo. Mockeamos sesión, query y SecureImage (que firma URLs).
const state = vi.hoisted(() => ({ logoUrl: null as string | null }))
vi.mock('../SessionContext', () => ({ useSession: () => ({ company_id: 'c1' }) }))
vi.mock('../../../domain/branding/queries', () => ({
  useCompanyLogoQuery: () => ({ data: { id: 'c1', nombre: 'Acme', logo_url: state.logoUrl } }),
}))
vi.mock('../SecureImage', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SecureImage: (p: any) => <img data-testid="company-logo" alt={p.alt} />,
}))

import { CompanyBrandMark } from '../CompanyBrandMark'

afterEach(cleanup)

describe('CompanyBrandMark', () => {
  it('con logo de empresa → muestra el logo (SecureImage)', () => {
    state.logoUrl = 'company-logos/c1/logo.png'
    render(<CompanyBrandMark />)
    const img = screen.getByTestId('company-logo')
    expect(img).toBeTruthy()
    expect(img.getAttribute('alt')).toBe('Logo de Acme')
  })

  it('sin logo → cae al BrandLogo (svg), sin imagen de empresa', () => {
    state.logoUrl = null
    const { container } = render(<CompanyBrandMark />)
    expect(screen.queryByTestId('company-logo')).toBeNull()
    expect(container.querySelector('svg')).toBeTruthy()
  })
})
