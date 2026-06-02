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

  describe('recientes', () => {
    it('muestra heading "Recientes" cuando hay recentIds y query vacia', async () => {
      render(<CommandPalette items={ITEMS} recentIds={['cuotas']} shortcut="ctrl" />)
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
      await waitFor(() => expect(screen.getByLabelText('Buscar')).toBeTruthy())
      expect(screen.getByText('Recientes')).toBeTruthy()
      expect(screen.getByText('Todos')).toBeTruthy()
    })

    it('NO muestra headings cuando recentIds esta vacio', async () => {
      render(<CommandPalette items={ITEMS} recentIds={[]} shortcut="ctrl" />)
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
      await waitFor(() => expect(screen.getByLabelText('Buscar')).toBeTruthy())
      expect(screen.queryByText('Recientes')).toBeNull()
      expect(screen.queryByText('Todos')).toBeNull()
    })

    it('NO muestra headings cuando query tiene texto', async () => {
      render(<CommandPalette items={ITEMS} recentIds={['cuotas']} shortcut="ctrl" />)
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
      await waitFor(() => expect(screen.getByLabelText('Buscar')).toBeTruthy())
      fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'cuo' } })
      expect(screen.queryByText('Recientes')).toBeNull()
      expect(screen.queryByText('Todos')).toBeNull()
    })

    it('items recientes aparecen al tope en orden de recentIds', async () => {
      render(
        <CommandPalette
          items={ITEMS}
          recentIds={['mascotas', 'visitantes']}
          shortcut="ctrl"
        />
      )
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
      await waitFor(() => expect(screen.getByLabelText('Buscar')).toBeTruthy())
      const options = screen.getAllByRole('option')
      // [0] Mascotas (recent), [1] Visitantes (recent), [2] Panel, [3] Cuotas
      expect(options[0].textContent).toContain('Mascotas')
      expect(options[1].textContent).toContain('Visitantes')
      expect(options[2].textContent).toContain('Panel')
    })

    it('ignora recentIds que no matcheen items actuales', async () => {
      render(
        <CommandPalette
          items={ITEMS}
          recentIds={['no-existe', 'cuotas']}
          shortcut="ctrl"
        />
      )
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
      await waitFor(() => expect(screen.getByLabelText('Buscar')).toBeTruthy())
      // Solo "cuotas" es valido — debe ser el unico recent
      const options = screen.getAllByRole('option')
      expect(options[0].textContent).toContain('Cuotas')
      expect(screen.getByText('Recientes')).toBeTruthy()
    })

    it('onItemSelected dispara al hacer Enter', async () => {
      const onItemSelected = vi.fn()
      const onSelect = vi.fn()
      render(
        <CommandPalette
          items={[{ id: 'panel', label: 'Panel', onSelect }]}
          onItemSelected={onItemSelected}
          shortcut="ctrl"
        />
      )
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
      await waitFor(() => expect(screen.getByLabelText('Buscar')).toBeTruthy())
      fireEvent.keyDown(screen.getByLabelText('Buscar'), { key: 'Enter' })
      expect(onSelect).toHaveBeenCalled()
      expect(onItemSelected).toHaveBeenCalled()
      expect(onItemSelected.mock.calls[0][0].id).toBe('panel')
    })

    it('onItemSelected dispara al hacer click', async () => {
      const onItemSelected = vi.fn()
      render(
        <CommandPalette
          items={[{ id: 'cuotas', label: 'Cuotas', onSelect: vi.fn() }]}
          onItemSelected={onItemSelected}
          shortcut="ctrl"
        />
      )
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
      await waitFor(() => expect(screen.getByLabelText('Buscar')).toBeTruthy())
      fireEvent.click(screen.getByText('Cuotas'))
      expect(onItemSelected).toHaveBeenCalled()
    })
  })
})
