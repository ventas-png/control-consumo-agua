import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { DialogProvider, confirm, notify } from '../Dialog'
import { checkA11y } from '../../../test/a11y'

beforeEach(cleanup)

describe('Dialog confirm', () => {
  it('renderiza titulo + texto y resuelve con isConfirmed=true al click Confirmar', async () => {
    render(<DialogProvider><div /></DialogProvider>)
    const resultPromise = confirm({ title: 'Borrar item', text: 'Esta acción no se puede deshacer.' })
    await waitFor(() => expect(screen.getByText('Borrar item')).toBeTruthy())
    expect(screen.getByText('Esta acción no se puede deshacer.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    const result = await resultPromise
    expect(result.isConfirmed).toBe(true)
  })

  it('resuelve con isConfirmed=false al click Cancelar', async () => {
    render(<DialogProvider><div /></DialogProvider>)
    const resultPromise = confirm({ title: 'Confirmar', cancelText: 'No' })
    await waitFor(() => expect(screen.getByText('Confirmar')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    const result = await resultPromise
    expect(result.isConfirmed).toBe(false)
  })

  it('usa AlertDialog role para que screen readers anuncien', async () => {
    render(<DialogProvider><div /></DialogProvider>)
    void confirm({ title: 'A11y test' })
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toBeTruthy()
  })

  it('pasa axe accesibilidad baseline con dialog abierto', async () => {
    const { container } = render(<DialogProvider><div /></DialogProvider>)
    void confirm({ title: 'Confirmar acción', text: 'Descripción del impacto.', variant: 'danger', confirmText: 'Sí, eliminar' })
    await screen.findByRole('alertdialog')
    await checkA11y(container)
  })
})

describe('Dialog notify (toast)', () => {
  it('renderiza un toast y se autocierra cuando duration=0 no aplica', async () => {
    render(<DialogProvider><div /></DialogProvider>)
    notify({ title: 'Guardado', variant: 'success', duration: 0 })
    await waitFor(() => expect(screen.getByText('Guardado')).toBeTruthy())
  })

  it('usa role status para alertas no-modales', async () => {
    render(<DialogProvider><div /></DialogProvider>)
    notify({ title: 'Info silenciosa', duration: 0 })
    const statusRegion = await waitFor(() => screen.getByRole('status'))
    expect(statusRegion).toBeTruthy()
  })
})
