import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { Breadcrumbs } from '../Breadcrumbs'
import { buildBreadcrumbs } from '../navRegistry'
import { checkA11y } from '../../../test/a11y'

beforeEach(cleanup)

describe('navRegistry.buildBreadcrumbs', () => {
  it('sección dentro de grupo → [Grupo, Sección]', () => {
    const crumbs = buildBreadcrumbs('cobros')
    expect(crumbs).toHaveLength(2)
    expect(crumbs[0]).toMatchObject({ label: 'Manejo Agua', target: 'dashboard' })
    expect(crumbs[1]).toMatchObject({ label: 'Cobros' })
    // El último nivel nunca lleva target (es la página actual).
    expect(crumbs[1].target).toBeUndefined()
  })

  it('sección que es ancla del grupo → el crumb del grupo no enlaza a la página actual', () => {
    // `dashboard` es la ancla de "Manejo Agua": el crumb del grupo no debe
    // apuntar a sí mismo.
    const crumbs = buildBreadcrumbs('dashboard')
    expect(crumbs).toHaveLength(2)
    expect(crumbs[0]).toMatchObject({ label: 'Manejo Agua' })
    expect(crumbs[0].target).toBeUndefined()
  })

  it('sección de condominios → grupo "Manejo Condominios"', () => {
    const crumbs = buildBreadcrumbs('condominios_cuotas')
    expect(crumbs[0]).toMatchObject({ label: 'Manejo Condominios', target: 'condominios_dashboard' })
    expect(crumbs[1].label).toBe('Cuotas')
  })

  it('sección standalone (sin grupo) → un solo nivel', () => {
    const crumbs = buildBreadcrumbs('configuracion')
    expect(crumbs).toHaveLength(1)
    expect(crumbs[0]).toMatchObject({ label: 'Config. del sistema' })
    expect(crumbs[0].target).toBeUndefined()
  })
})

describe('Breadcrumbs', () => {
  it('renderiza un landmark <nav> con aria-label', () => {
    render(<Breadcrumbs activeSection="cobros" onNavigate={() => {}} />)
    expect(screen.getByRole('navigation', { name: 'Ruta de navegación' })).toBeTruthy()
  })

  it('refleja la jerarquía Sección › Subsección de la sección activa', () => {
    render(<Breadcrumbs activeSection="condominios_visitantes" onNavigate={() => {}} />)
    const nav = screen.getByRole('navigation', { name: 'Ruta de navegación' })
    expect(within(nav).getByText('Manejo Condominios')).toBeTruthy()
    expect(within(nav).getByText('Visitantes')).toBeTruthy()
  })

  it('marca el último nivel con aria-current="page"', () => {
    render(<Breadcrumbs activeSection="cobros" onNavigate={() => {}} />)
    const current = screen.getByText('Cobros')
    expect(current.getAttribute('aria-current')).toBe('page')
    // El crumb padre (grupo) NO es la página actual.
    expect(screen.getByText('Manejo Agua').getAttribute('aria-current')).toBeNull()
  })

  it('el nivel superior es un botón que navega al hacer click (sin recarga)', () => {
    const onNavigate = vi.fn()
    render(<Breadcrumbs activeSection="condominios_cuotas" onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Manejo Condominios' }))
    expect(onNavigate).toHaveBeenCalledWith('condominios_dashboard')
  })

  it('el nivel actual no es interactivo (no es botón)', () => {
    render(<Breadcrumbs activeSection="cobros" onNavigate={() => {}} />)
    // Solo el grupo es botón; "Cobros" (actual) es texto.
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].textContent).toBe('Manejo Agua')
  })

  it('el nivel superior es navegable por teclado (botón nativo focusable)', () => {
    render(<Breadcrumbs activeSection="cobros" onNavigate={() => {}} />)
    const groupBtn = screen.getByRole('button', { name: 'Manejo Agua' })
    // Botón nativo: tabbable por defecto (sin tabindex negativo) y enfocable.
    expect(groupBtn.tagName).toBe('BUTTON')
    expect(groupBtn.getAttribute('tabindex')).not.toBe('-1')
    groupBtn.focus()
    expect(groupBtn).toBe(document.activeElement)
  })

  it('sección standalone renderiza un único crumb actual', () => {
    render(<Breadcrumbs activeSection="configuracion" onNavigate={() => {}} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByText('Config. del sistema').getAttribute('aria-current')).toBe('page')
  })

  it('a11y baseline: Breadcrumbs pasa axe sin violaciones', async () => {
    const { container } = render(<Breadcrumbs activeSection="condominios_cuotas" onNavigate={() => {}} />)
    await checkA11y(container)
  })
})
