import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TabStrip, type TabStripItem } from '../TabStrip'
import { checkA11y } from '../../../test/a11y'

beforeEach(cleanup)

type Tab = 'polizas' | 'balanza' | 'eeff'

const items: TabStripItem<Tab>[] = [
  { id: 'polizas', label: 'Pólizas', icon: '📒' },
  { id: 'balanza', label: 'Balanza', icon: '⚖️' },
  { id: 'eeff', label: 'Estados financieros' },
]

function setup(value: Tab = 'polizas', onChange = vi.fn()) {
  const utils = render(
    <TabStrip items={items} value={value} onChange={onChange} ariaLabel="Secciones" />,
  )
  return { ...utils, onChange }
}

describe('TabStrip', () => {
  it('renderiza una pestaña por item, con y sin icono', () => {
    setup()
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByText('Pólizas')).toBeDefined()
    expect(screen.getByText('Estados financieros')).toBeDefined()
  })

  it('marca aria-selected solo en la pestaña activa', () => {
    setup('balanza')
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map(t => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
  })

  it('notifica el cambio al hacer click', () => {
    const { onChange } = setup('polizas')
    fireEvent.click(screen.getByText('Balanza'))
    expect(onChange).toHaveBeenCalledWith('balanza')
  })

  // Roving tabindex: solo la activa entra en el orden de tabulación, así el
  // teclado no tiene que recorrer las 9 pestañas de Contabilidad para salir.
  it('usa roving tabindex', () => {
    setup('balanza')
    expect(screen.getAllByRole('tab').map(t => t.getAttribute('tabindex')))
      .toEqual(['-1', '0', '-1'])
  })

  it('las flechas ←/→ mueven entre pestañas y dan la vuelta', () => {
    const { onChange, rerender } = setup('balanza')
    const strip = screen.getByRole('tablist')

    fireEvent.keyDown(strip, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('eeff')

    fireEvent.keyDown(strip, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('polizas')

    // Desde la última, ArrowRight vuelve a la primera.
    rerender(<TabStrip items={items} value="eeff" onChange={onChange} ariaLabel="Secciones" />)
    fireEvent.keyDown(strip, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('polizas')
  })

  it('ignora otras teclas', () => {
    const { onChange } = setup()
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowDown' })
    expect(onChange).not.toHaveBeenCalled()
  })

  // En móvil la tira scrollea en horizontal: sin wrap, las pestañas ocupan una
  // sola línea en vez de empujar el contenido varias filas hacia abajo.
  it('es una tira scrollable de una sola línea (no wrap)', () => {
    setup()
    const strip = screen.getByRole('tablist')
    expect(strip.className).toContain('tab-strip-scrollable')
    expect(strip.style.overflowX).toBe('auto')
    expect(strip.style.flexWrap).toBe('')
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.style.whiteSpace).toBe('nowrap')
    }
  })

  it('renderiza sin violaciones de accesibilidad', async () => {
    const { container } = setup('balanza')
    await checkA11y(container)
  })
})
