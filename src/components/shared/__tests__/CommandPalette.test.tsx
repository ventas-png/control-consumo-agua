import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { CommandPalette, type CommandItem } from '../CommandPalette'
import { checkA11y } from '../../../test/a11y'

beforeEach(cleanup)

const ITEMS: CommandItem[] = [
  { id: 'panel',      label: 'Panel',      icon: '📊', group: 'General', onSelect: vi.fn() },
  { id: 'cuotas',     label: 'Cuotas',     icon: '💳', group: 'Cobranza', onSelect: vi.fn() },
  { id: 'visitantes', label: 'Visitantes', icon: '🚪', group: 'Seguridad', onSelect: vi.fn() },
  { id: 'mascotas',   label: 'Mascotas',   icon: '🐾', group: 'Comunidad', onSelect: vi.fn(), keywords: 'pet animal perro' },
]

describe('CommandPalette', () => {
  it('abre al presionar Ctrl+K (no-mac default)', async () => {
    render(<CommandPalette items={ITEMS} shortcut="ctrl" />)
    expect(screen.queryByLabelText('Buscar')).toBeNull()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await waitFor(() => expect(screen.getByLabelText('Buscar')).toBeTruthy())
  })

  it('cierra con ESC', async () => {
    render(<CommandPalette items={ITEMS} shortcut="ctrl" />)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await waitFor(() => expect(screen.getByLabelText('Buscar')).toBeTruthy())
    fireEvent.keyDown(screen.getByLabelText('Buscar'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByLabelText('Buscar')).toBeNull())
  })

  it('filtra items por query', async () => {
    render(<CommandPalette items={ITEMS} shortcut="ctrl" />)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await waitFor(() => expect(screen.getByLabelText('Buscar')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'cuot' } })
    expect(screen.getByText('Cuotas')).toBeTruthy()
    expect(screen.queryByText('Panel')).toBeNull()
    expect(screen.queryByText('Visitantes')).toBeNull()
  })

  it('match via keywords (alias)', async () => {
    render(<CommandPalette items={ITEMS} shortcut="ctrl" />)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await waitFor(() => expect(screen.getByLabelText('Buscar')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'perro' } })
    expect(screen.getByText('Mascotas')).toBeTruthy()
  })

  it('ArrowDown/ArrowUp navega y Enter activa onSelect', async () => {
    const onSelect = vi.fn()
    const items: CommandItem[] = [
      { id: 'a', label: 'Alpha', onSelect },
      { id: 'b', label: 'Beta', onSelect: vi.fn() },
    ]
    render(<CommandPalette items={items} shortcut="ctrl" />)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await waitFor(() => expect(screen.getByLabelText('Buscar')).toBeTruthy())
    const input = screen.getByLabelText('Buscar')
    // Default selectedIdx=0 → Alpha
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalled()
  })

  it('"Sin resultados" para query sin matches', async () => {
    render(<CommandPalette items={ITEMS} shortcut="ctrl" />)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await waitFor(() => expect(screen.getByLabelText('Buscar')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'xyz123' } })
    expect(screen.getByText(/Sin resultados/)).toBeTruthy()
  })

  it('a11y: dialog abierto sin violaciones', async () => {
    const { container } = render(<CommandPalette items={ITEMS} shortcut="ctrl" />)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await waitFor(() => expect(screen.getByLabelText('Buscar')).toBeTruthy())
    await checkA11y(container)
  })

  it('items muestran group badge cuando se proveen', async () => {
    render(<CommandPalette items={ITEMS} shortcut="ctrl" />)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await waitFor(() => expect(screen.getByLabelText('Buscar')).toBeTruthy())
    expect(screen.getByText('General')).toBeTruthy()
    expect(screen.getByText('Cobranza')).toBeTruthy()
  })
})
