import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { DialogProvider } from '../Dialog'

// Venta del plan permitida por defecto (web); el test de la app nativa la apaga.
const venta = vi.hoisted(() => ({ mostrarVentaDePlanes: vi.fn(() => true) }))
vi.mock('../../../lib/ventaDePlanes', () => venta)
import { promptUpgrade, openBillingSection, OPEN_AMPLIAR_EVENT, OPEN_AMPLIAR_FLAG, OPEN_BILLING_EVENT, OPEN_BILLING_FLAG } from '../promptUpgrade'
import { checkA11y } from '../../../test/a11y'

beforeEach(() => {
  cleanup()
  sessionStorage.clear()
  venta.mostrarVentaDePlanes.mockReturnValue(true)
})

describe('promptUpgrade', () => {
  it('renderiza titulo + texto con conteo y limite', async () => {
    render(<DialogProvider><div /></DialogProvider>)
    void promptUpgrade({ resource: 'project', current: 3, limit: 3 })
    await waitFor(() => expect(screen.getByText('Límite del plan alcanzado')).toBeTruthy())
    expect(screen.getByText(/3 proyectos/)).toBeTruthy()
    expect(screen.getByText(/ya tienes 3/)).toBeTruthy()
  })

  it('al confirmar dispara el evento de ampliación y setea su flag', async () => {
    const handler = vi.fn()
    window.addEventListener(OPEN_AMPLIAR_EVENT, handler)
    render(<DialogProvider><div /></DialogProvider>)
    const resultPromise = promptUpgrade({ resource: 'unit', current: 50, limit: 50 })
    await waitFor(() => expect(screen.getByText('Límite del plan alcanzado')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar plan' }))
    const result = await resultPromise
    expect(result).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(OPEN_AMPLIAR_FLAG)).toBe('1')
    window.removeEventListener(OPEN_AMPLIAR_EVENT, handler)
  })

  it('openBillingSection (flow de billing) sigue usando el evento/flag de Perfil', () => {
    const handler = vi.fn()
    window.addEventListener(OPEN_BILLING_EVENT, handler)
    openBillingSection()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(OPEN_BILLING_FLAG)).toBe('1')
    window.removeEventListener(OPEN_BILLING_EVENT, handler)
  })

  it('al cancelar no dispara evento ni setea flag', async () => {
    const handler = vi.fn()
    window.addEventListener(OPEN_AMPLIAR_EVENT, handler)
    render(<DialogProvider><div /></DialogProvider>)
    const resultPromise = promptUpgrade({ resource: 'project', current: 5, limit: 5 })
    await waitFor(() => expect(screen.getByText('Límite del plan alcanzado')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Más tarde' }))
    const result = await resultPromise
    expect(result).toBe(false)
    expect(handler).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(OPEN_AMPLIAR_FLAG)).toBeNull()
    window.removeEventListener(OPEN_AMPLIAR_EVENT, handler)
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

// App Store 3.1.1 / política de pagos de Google Play: en la app nativa se informa
// el límite, pero sin ofrecer ampliar el plan (ampliar es venderlo).
describe('promptUpgrade — app nativa', () => {
  // `confirm` es un singleton de módulo y tests anteriores dejan un diálogo web
  // sin resolver que reaparece al montar el provider. Por eso se usan cifras
  // propias (47 unidades) y se comprueba que NO hay un diálogo de ampliar con
  // ellas, en vez de buscar cualquier botón "Ampliar plan".
  it('informa el límite sin CTA de ampliar y no dispara la ampliación', async () => {
    venta.mostrarVentaDePlanes.mockReturnValue(false)
    const handler = vi.fn()
    window.addEventListener(OPEN_AMPLIAR_EVENT, handler)
    render(<DialogProvider><div /></DialogProvider>)
    const eligioAmpliar = await promptUpgrade({ resource: 'unit', current: 47, limit: 47 })
    expect(eligioAmpliar).toBe(false)
    await waitFor(() => expect(screen.getByText('Tu plan permite hasta 47 unidades y ya tienes 47.')).toBeTruthy())
    expect(screen.queryByText(/47 unidades[\s\S]*Amplía/)).toBeNull()
    expect(handler).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(OPEN_AMPLIAR_FLAG)).toBeNull()
    window.removeEventListener(OPEN_AMPLIAR_EVENT, handler)
  })
})
