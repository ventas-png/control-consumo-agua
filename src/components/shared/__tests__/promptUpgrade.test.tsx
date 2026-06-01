import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { DialogProvider } from '../Dialog'
import { promptUpgrade, OPEN_BILLING_EVENT, OPEN_BILLING_FLAG } from '../promptUpgrade'
import { checkA11y } from '../../../test/a11y'

beforeEach(() => {
  cleanup()
  sessionStorage.clear()
})

describe('promptUpgrade', () => {
  it('renderiza titulo + texto con conteo y limite', async () => {
    render(<DialogProvider><div /></DialogProvider>)
    void promptUpgrade({ resource: 'project', current: 3, limit: 3 })
    await waitFor(() => expect(screen.getByText('Límite del plan alcanzado')).toBeTruthy())
    expect(screen.getByText(/3 proyectos/)).toBeTruthy()
    expect(screen.getByText(/ya tienes 3/)).toBeTruthy()
  })

  it('al confirmar dispara CustomEvent y setea flag sessionStorage', async () => {
    const handler = vi.fn()
    window.addEventListener(OPEN_BILLING_EVENT, handler)
    render(<DialogProvider><div /></DialogProvider>)
    const resultPromise = promptUpgrade({ resource: 'unit', current: 50, limit: 50 })
    await waitFor(() => expect(screen.getByText('Límite del plan alcanzado')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Ver planes' }))
    const result = await resultPromise
    expect(result).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(OPEN_BILLING_FLAG)).toBe('1')
    window.removeEventListener(OPEN_BILLING_EVENT, handler)
  })

  it('al cancelar no dispara evento ni setea flag', async () => {
    const handler = vi.fn()
    window.addEventListener(OPEN_BILLING_EVENT, handler)
    render(<DialogProvider><div /></DialogProvider>)
    const resultPromise = promptUpgrade({ resource: 'project', current: 5, limit: 5 })
    await waitFor(() => expect(screen.getByText('Límite del plan alcanzado')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Más tarde' }))
    const result = await resultPromise
    expect(result).toBe(false)
    expect(handler).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(OPEN_BILLING_FLAG)).toBeNull()
    window.removeEventListener(OPEN_BILLING_EVENT, handler)
  })

  it('usa el plural correcto segun resource: proyectos vs unidades', async () => {
    render(<DialogProvider><div /></DialogProvider>)
    void promptUpgrade({ resource: 'unit', current: 50, limit: 50 })
    await waitFor(() => expect(screen.getByText(/50 unidades/)).toBeTruthy())
  })

  it('pasa axe baseline con dialog abierto', async () => {
    const { container } = render(<DialogProvider><div /></DialogProvider>)
    void promptUpgrade({ resource: 'project', current: 3, limit: 3 })
    await screen.findByRole('alertdialog')
    await checkA11y(container)
  })
})
