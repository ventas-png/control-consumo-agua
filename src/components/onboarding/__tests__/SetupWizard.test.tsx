import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { SetupWizard } from '../SetupWizard'
import type { UserSession } from '../../../types'

beforeEach(cleanup)

// Mock supabase para evitar real DB calls en tests
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn(() => Promise.resolve({ error: null })),
    })),
  },
}))

const USER: UserSession = {
  user_id: 'u1',
  email: 'admin@test.com',
  name: 'Admin Test',
  role: 'admin',
  company_id: 'c1',
  login_time: new Date().toISOString(),
  expires_at: new Date(Date.now() + 86400000).toISOString(),
}

describe('SetupWizard', () => {
  it('autoOpen renderiza el primer paso (welcome)', async () => {
    render(<SetupWizard currentUser={USER} autoOpen />)
    await waitFor(() => expect(screen.getByText(/Configurar tu empresa/)).toBeTruthy())
    expect(screen.getByText(/Hola/)).toBeTruthy()
    expect(screen.getByText('Admin Test')).toBeTruthy()
  })

  it('progress bar muestra paso 1 de 4 al inicio', async () => {
    render(<SetupWizard currentUser={USER} autoOpen />)
    await waitFor(() => expect(screen.getByText(/Configurar tu empresa/)).toBeTruthy())
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('1')
    expect(bar.getAttribute('aria-valuemax')).toBe('4')
  })

  it('navegación Empezar → Tipo de proyecto', async () => {
    render(<SetupWizard currentUser={USER} autoOpen />)
    await waitFor(() => expect(screen.getByText(/Configurar tu empresa/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Empezar/ }))
    await waitFor(() => expect(screen.getByText(/Tipo de proyecto/)).toBeTruthy())
    expect(screen.getByText('Condominios')).toBeTruthy()
    expect(screen.getByText(/Control de agua potable/)).toBeTruthy()
  })

  it('seleccionar tipo cambia aria-pressed', async () => {
    render(<SetupWizard currentUser={USER} autoOpen />)
    await waitFor(() => expect(screen.getByText(/Configurar tu empresa/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Empezar/ }))
    await waitFor(() => expect(screen.getByText(/Tipo de proyecto/)).toBeTruthy())
    const aguaCard = screen.getByText('Control de agua potable').closest('button')!
    fireEvent.click(aguaCard)
    expect(aguaCard.getAttribute('aria-pressed')).toBe('true')
  })

  it('botón Atrás vuelve al paso anterior', async () => {
    render(<SetupWizard currentUser={USER} autoOpen />)
    await waitFor(() => expect(screen.getByText(/Configurar tu empresa/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Empezar/ }))
    await waitFor(() => expect(screen.getByText(/Tipo de proyecto/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Atrás/ }))
    await waitFor(() => expect(screen.getByText(/Configurar tu empresa/)).toBeTruthy())
  })

  it('paso 3 muestra form de proyecto con nombre obligatorio', async () => {
    render(<SetupWizard currentUser={USER} autoOpen />)
    await waitFor(() => expect(screen.getByText(/Configurar tu empresa/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Empezar/ }))
    await waitFor(() => expect(screen.getByText(/Tipo de proyecto/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }))
    await waitFor(() => expect(screen.getByText(/Crear primer proyecto/)).toBeTruthy())
    expect(screen.getByLabelText(/Nombre/)).toBeTruthy()
    expect(screen.getByLabelText(/Moneda/)).toBeTruthy()
  })
})
