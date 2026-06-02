import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Button } from '../Button'
import { checkA11y } from '../../../test/a11y'

beforeEach(cleanup)

describe('Button — render básico', () => {
  it('renderiza el children como label', () => {
    render(<Button>Guardar</Button>)
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDefined()
  })

  it('type default es "button" para evitar submits accidentales', () => {
    render(<Button>X</Button>)
    expect(screen.getByRole('button').getAttribute('type')).toBe('button')
  })

  it('permite override de type a submit', () => {
    render(<Button type="submit">Enviar</Button>)
    expect(screen.getByRole('button').getAttribute('type')).toBe('submit')
  })

  it('invoca onClick al hacer click', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>X</Button>)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('Button — disabled / loading', () => {
  it('disabled prop marca el botón disabled', () => {
    render(<Button disabled>X</Button>)
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true)
  })

  it('loading=true deshabilita el botón y marca aria-busy', () => {
    render(<Button loading>Guardar</Button>)
    const btn = screen.getByRole('button')
    expect(btn.hasAttribute('disabled')).toBe(true)
    expect(btn.getAttribute('aria-busy')).toBe('true')
  })

  it('loading=true muestra spinner', () => {
    const { container } = render(<Button loading>X</Button>)
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('loadingText reemplaza children cuando loading=true', () => {
    render(<Button loading loadingText="Guardando…">Guardar</Button>)
    expect(screen.getByText('Guardando…')).toBeDefined()
    expect(screen.queryByText('Guardar')).toBeNull()
  })

  it('no invoca onClick cuando loading=true', () => {
    const onClick = vi.fn()
    render(<Button loading onClick={onClick}>X</Button>)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('Button — variants', () => {
  it('aplica style del variant primary por default', () => {
    const { container } = render(<Button>X</Button>)
    const btn = container.querySelector('button') as HTMLElement
    expect(btn.style.background).toContain('at-primary')
  })

  it('variant=success usa color de éxito', () => {
    const { container } = render(<Button variant="success">X</Button>)
    const btn = container.querySelector('button') as HTMLElement
    expect(btn.style.background).toContain('at-success')
  })

  it('variant=gradient-primary aplica linear-gradient', () => {
    const { container } = render(<Button variant="gradient-primary">X</Button>)
    const btn = container.querySelector('button') as HTMLElement
    expect(btn.style.background).toContain('linear-gradient')
  })

  it('variant=outline-primary tiene fondo transparente', () => {
    const { container } = render(<Button variant="outline-primary">X</Button>)
    const btn = container.querySelector('button') as HTMLElement
    expect(btn.style.background).toBe('transparent')
  })
})

describe('Button — sizes', () => {
  it('size=md (default) usa fontSize 14', () => {
    const { container } = render(<Button>X</Button>)
    const btn = container.querySelector('button') as HTMLElement
    expect(btn.style.fontSize).toBe('14px')
  })

  it('size=sm usa fontSize 13', () => {
    const { container } = render(<Button size="sm">X</Button>)
    const btn = container.querySelector('button') as HTMLElement
    expect(btn.style.fontSize).toBe('13px')
  })

  it('size=lg usa fontSize 15', () => {
    const { container } = render(<Button size="lg">X</Button>)
    const btn = container.querySelector('button') as HTMLElement
    expect(btn.style.fontSize).toBe('15px')
  })
})

describe('Button — block', () => {
  it('block=true aplica width 100%', () => {
    const { container } = render(<Button block>X</Button>)
    const btn = container.querySelector('button') as HTMLElement
    expect(btn.style.width).toBe('100%')
  })

  it('block=false no aplica width', () => {
    const { container } = render(<Button>X</Button>)
    const btn = container.querySelector('button') as HTMLElement
    expect(btn.style.width).toBe('')
  })
})

describe('Button — icons', () => {
  it('iconLeft se renderiza antes del children', () => {
    const { container } = render(
      <Button iconLeft={<span data-testid="ic">📄</span>}>PDF</Button>,
    )
    const btn = container.querySelector('button')!
    const ic = btn.querySelector('[data-testid="ic"]')
    expect(ic).not.toBeNull()
    // children "PDF" debe venir DESPUES del icono en el DOM order
    expect(btn.textContent).toBe('📄PDF')
  })

  it('iconRight se renderiza después del children', () => {
    const { container } = render(
      <Button iconRight={<span>→</span>}>Siguiente</Button>,
    )
    expect(container.querySelector('button')!.textContent).toBe('Siguiente→')
  })

  it('iconLeft NO se renderiza cuando loading=true (lo reemplaza spinner)', () => {
    const { container } = render(
      <Button loading iconLeft={<span data-testid="ic">📄</span>}>PDF</Button>,
    )
    expect(container.querySelector('[data-testid="ic"]')).toBeNull()
  })
})

describe('Button — a11y baseline', () => {
  it('renderiza sin violaciones de accesibilidad', async () => {
    const { container } = render(
      <div>
        <Button>Primary</Button>
        <Button variant="danger">Danger</Button>
        <Button loading loadingText="Guardando…">Guardar</Button>
        <Button disabled>Disabled</Button>
      </div>,
    )
    await checkA11y(container)
  })
})
