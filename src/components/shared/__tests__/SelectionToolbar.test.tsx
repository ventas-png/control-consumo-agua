import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SelectionToolbar, type BulkAction } from '../SelectionToolbar'

beforeEach(() => cleanup())

const ACTION_DELETE: BulkAction = {
  id: 'delete',
  label: 'Eliminar',
  icon: '🗑',
  variant: 'danger',
  onClick: vi.fn(),
}
const ACTION_EXPORT: BulkAction = {
  id: 'export',
  label: 'Exportar',
  icon: '📤',
  onClick: vi.fn(),
}

describe('SelectionToolbar', () => {
  it('no renderiza cuando count = 0', () => {
    const { container } = render(
      <SelectionToolbar count={0} actions={[ACTION_DELETE]} onClear={() => {}} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renderiza count con plural correcto', () => {
    render(<SelectionToolbar count={5} actions={[ACTION_DELETE]} onClear={() => {}} />)
    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.getByText('elementos')).toBeTruthy()
  })

  it('singular cuando count = 1', () => {
    render(<SelectionToolbar count={1} actions={[ACTION_DELETE]} onClear={() => {}} />)
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('elemento')).toBeTruthy()
  })

  it('entityLabel custom', () => {
    render(
      <SelectionToolbar
        count={3}
        actions={[ACTION_DELETE]}
        onClear={() => {}}
        entityLabel={{ one: 'cuota', many: 'cuotas' }}
      />
    )
    expect(screen.getByText('cuotas')).toBeTruthy()
  })

  it('role=toolbar con aria-label descriptivo', () => {
    render(<SelectionToolbar count={2} actions={[ACTION_DELETE]} onClear={() => {}} />)
    const toolbar = screen.getByRole('toolbar')
    expect(toolbar.getAttribute('aria-label')).toContain('2 elementos seleccionados')
  })

  it('clickear action dispara onClick', () => {
    const onClick = vi.fn()
    render(
      <SelectionToolbar
        count={3}
        actions={[{ ...ACTION_DELETE, onClick }]}
        onClear={() => {}}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    expect(onClick).toHaveBeenCalled()
  })

  it('action disabled no dispara onClick', () => {
    const onClick = vi.fn()
    render(
      <SelectionToolbar
        count={1}
        actions={[{ ...ACTION_EXPORT, onClick, disabled: true, disabledReason: 'Selección mixta' }]}
        onClear={() => {}}
      />
    )
    const btn = screen.getByRole('button', { name: 'Exportar' })
    expect(btn.hasAttribute('disabled')).toBe(true)
    expect(btn.getAttribute('title')).toBe('Selección mixta')
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('botón "Limpiar" llama onClear', () => {
    const onClear = vi.fn()
    render(<SelectionToolbar count={5} actions={[ACTION_DELETE]} onClear={onClear} />)
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar selección' }))
    expect(onClear).toHaveBeenCalled()
  })

  it('leftSlot se renderiza cuando se pasa', () => {
    render(
      <SelectionToolbar
        count={3}
        actions={[ACTION_DELETE]}
        onClear={() => {}}
        leftSlot={<span>Total: $1,200</span>}
      />
    )
    expect(screen.getByText('Total: $1,200')).toBeTruthy()
  })
})
