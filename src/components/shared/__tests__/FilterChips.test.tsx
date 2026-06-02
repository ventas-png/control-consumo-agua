import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FilterChips, type FilterChipOption } from '../FilterChips'
import { checkA11y } from '../../../test/a11y'

beforeEach(cleanup)

type Estado = 'todos' | 'activo' | 'pendiente' | 'cerrado'

const options: FilterChipOption<Estado>[] = [
  { value: 'todos',     label: 'Todos',     count: 42 },
  { value: 'activo',    label: 'Activos',   count: 30, color: 'var(--at-success)' },
  { value: 'pendiente', label: 'Pendientes', count: 8, color: 'var(--at-warning)' },
  { value: 'cerrado',   label: 'Cerrados',  count: 4, color: 'var(--at-ink-3)' },
]

describe('FilterChips — single-select (default)', () => {
  it('renderiza un chip por opción con label y count', () => {
    render(<FilterChips options={options} value="todos" onChange={() => {}} />)
    expect(screen.getByText('Todos')).toBeDefined()
    expect(screen.getByText('(42)')).toBeDefined()
    expect(screen.getByText('Activos')).toBeDefined()
    expect(screen.getByText('(30)')).toBeDefined()
  })

  it('omite count cuando no se provee', () => {
    const opts: FilterChipOption<'a' | 'b'>[] = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ]
    render(<FilterChips options={opts} value="a" onChange={() => {}} />)
    expect(screen.queryByText(/\(/)).toBeNull()
  })

  it('marca aria-checked solo en el chip activo', () => {
    const { container } = render(
      <FilterChips options={options} value="activo" onChange={() => {}} />,
    )
    const checked = container.querySelectorAll('[aria-checked="true"]')
    const unchecked = container.querySelectorAll('[aria-checked="false"]')
    expect(checked).toHaveLength(1)
    expect(unchecked).toHaveLength(3)
  })

  it('invoca onChange con el value seleccionado', () => {
    const onChange = vi.fn()
    render(<FilterChips options={options} value="todos" onChange={onChange} />)
    fireEvent.click(screen.getByText('Activos'))
    expect(onChange).toHaveBeenCalledWith('activo')
  })

  it('aplica role="radiogroup" al contenedor y role="radio" a los chips', () => {
    const { container } = render(
      <FilterChips options={options} value="todos" onChange={() => {}} ariaLabel="Filtrar por estado" />,
    )
    expect(container.querySelector('[role="radiogroup"]')).not.toBeNull()
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(4)
    expect(container.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Filtrar por estado')
  })
})

describe('FilterChips — multi-select', () => {
  it('mantiene aria-checked=true en cada valor del array', () => {
    const { container } = render(
      <FilterChips
        options={options}
        value={['activo', 'pendiente']}
        onChange={() => {}}
        multi
      />,
    )
    expect(container.querySelectorAll('[aria-checked="true"]')).toHaveLength(2)
  })

  it('agrega el value al array cuando se selecciona uno nuevo', () => {
    const onChange = vi.fn()
    render(
      <FilterChips options={options} value={['activo']} onChange={onChange} multi />,
    )
    fireEvent.click(screen.getByText('Pendientes'))
    expect(onChange).toHaveBeenCalledWith(['activo', 'pendiente'])
  })

  it('remueve el value del array cuando se hace click en uno ya activo', () => {
    const onChange = vi.fn()
    render(
      <FilterChips options={options} value={['activo', 'pendiente']} onChange={onChange} multi />,
    )
    fireEvent.click(screen.getByText('Activos'))
    expect(onChange).toHaveBeenCalledWith(['pendiente'])
  })

  it('aplica role="group" y role="checkbox" en lugar de radio', () => {
    const { container } = render(
      <FilterChips options={options} value={[]} onChange={() => {}} multi />,
    )
    expect(container.querySelector('[role="group"]')).not.toBeNull()
    expect(container.querySelectorAll('[role="checkbox"]')).toHaveLength(4)
  })
})

describe('FilterChips — icon support', () => {
  it('renderiza el icon cuando se provee', () => {
    const opts: FilterChipOption<'a' | 'b'>[] = [
      { value: 'a', label: 'A', icon: <span data-testid="ic-a">📌</span> },
      { value: 'b', label: 'B' },
    ]
    render(<FilterChips options={opts} value="a" onChange={() => {}} />)
    expect(screen.getByTestId('ic-a')).toBeDefined()
  })
})

describe('FilterChips — a11y baseline', () => {
  it('renderiza sin violaciones de accesibilidad (single)', async () => {
    const { container } = render(
      <FilterChips options={options} value="activo" onChange={() => {}} ariaLabel="Estado" />,
    )
    await checkA11y(container)
  })

  it('renderiza sin violaciones de accesibilidad (multi)', async () => {
    const { container } = render(
      <FilterChips
        options={options}
        value={['activo']}
        onChange={() => {}}
        multi
        ariaLabel="Estado"
      />,
    )
    await checkA11y(container)
  })
})
