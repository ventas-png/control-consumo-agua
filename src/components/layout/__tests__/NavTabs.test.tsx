import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { NavTabs } from '../NavTabs'
import { checkA11y } from '../../../test/a11y'

beforeEach(cleanup)

describe('NavTabs', () => {
  it('renderiza con role=tablist + role=tab', () => {
    render(<NavTabs activeSection="dashboard" userRole="admin" onSelect={() => {}} />)
    expect(screen.getByRole('tablist')).toBeTruthy()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.length).toBeGreaterThan(0)
  })

  it('aria-selected refleja la seccion activa', () => {
    render(<NavTabs activeSection="dashboard" userRole="admin" onSelect={() => {}} />)
    const tabs = screen.getAllByRole('tab')
    const dashboardTab = tabs.find(t => t.textContent?.includes('Dashboard'))
    expect(dashboardTab?.getAttribute('aria-selected')).toBe('true')
    // Otros tabs deben tener aria-selected="false"
    const otherTabs = tabs.filter(t => t !== dashboardTab)
    otherTabs.forEach(t => expect(t.getAttribute('aria-selected')).toBe('false'))
  })

  it('tabIndex=0 solo en el tab activo (focus ring de teclado)', () => {
    render(<NavTabs activeSection="clientes" userRole="admin" onSelect={() => {}} />)
    const tabs = screen.getAllByRole('tab')
    const activeTabs = tabs.filter(t => t.tabIndex === 0)
    const inactiveTabs = tabs.filter(t => t.tabIndex === -1)
    expect(activeTabs).toHaveLength(1)
    expect(inactiveTabs.length).toBeGreaterThan(0)
  })

  it('filtra tabs por rol del usuario', () => {
    render(<NavTabs activeSection="tabla" userRole="viewer" onSelect={() => {}} />)
    const tabs = screen.getAllByRole('tab')
    // viewer ve: Dashboard, Mapa, Historial — no Configuración ni Calidad
    expect(tabs.some(t => t.textContent?.includes('Dashboard'))).toBe(true)
    expect(tabs.some(t => t.textContent?.includes('Configuración'))).toBe(false)
    expect(tabs.some(t => t.textContent?.includes('Calidad'))).toBe(false)
  })

  it('a11y baseline: NavTabs pasa axe sin violaciones', async () => {
    const { container } = render(<NavTabs activeSection="dashboard" userRole="admin" onSelect={() => {}} />)
    await checkA11y(container)
  })
})
