import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SystemHealthModal } from '../SystemHealthModal'

// Mock import.meta.env.VITE_SUPABASE_URL via stub.
vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')

const fetchSpy = vi.fn()
const originalFetch = globalThis.fetch

beforeEach(() => {
  cleanup()
  fetchSpy.mockReset()
  globalThis.fetch = fetchSpy as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

function makeOkResponse() {
  return new Response(JSON.stringify({
    status: 'ok',
    timestamp: '2026-06-01T17:00:00Z',
    uptime_ms: 90000,
    checks: { supabase_url: true, supabase_anon_key: true, service_role_key: true },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function makeDegradedResponse() {
  return new Response(JSON.stringify({
    status: 'degraded',
    timestamp: '2026-06-01T17:00:00Z',
    uptime_ms: 5000,
    checks: { supabase_url: true, supabase_anon_key: false, service_role_key: true },
  }), { status: 503, headers: { 'Content-Type': 'application/json' } })
}

describe('SystemHealthModal', () => {
  it('renderiza header y consulta /health endpoint', async () => {
    fetchSpy.mockResolvedValue(makeOkResponse())
    render(<SystemHealthModal onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('🩺 Salud del sistema')).toBeTruthy())
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://test.supabase.co/functions/v1/health',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('muestra "Operativo" cuando status es ok', async () => {
    fetchSpy.mockResolvedValue(makeOkResponse())
    render(<SystemHealthModal onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Operativo')).toBeTruthy())
  })

  it('muestra "Degradado" cuando status es degraded', async () => {
    fetchSpy.mockResolvedValue(makeDegradedResponse())
    render(<SystemHealthModal onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Degradado')).toBeTruthy())
  })

  it('muestra checks de variables de entorno con OK/FAIL', async () => {
    fetchSpy.mockResolvedValue(makeDegradedResponse())
    render(<SystemHealthModal onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('SUPABASE_URL')).toBeTruthy())
    expect(screen.getByText('SUPABASE_ANON_KEY')).toBeTruthy()
    expect(screen.getByText('SERVICE_ROLE_KEY')).toBeTruthy()
  })

  it('renderiza error cuando fetch falla', async () => {
    fetchSpy.mockRejectedValue(new Error('Network down'))
    render(<SystemHealthModal onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Sin respuesta')).toBeTruthy())
    // Network down aparece en multiple places (subtitle + history); ambos OK.
    expect(screen.getAllByText(/Network down/).length).toBeGreaterThanOrEqual(1)
  })

  it('llama onClose al hacer click en X', async () => {
    fetchSpy.mockResolvedValue(makeOkResponse())
    const onClose = vi.fn()
    render(<SystemHealthModal onClose={onClose} />)
    await waitFor(() => expect(screen.getByLabelText('Cerrar')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Cerrar'))
    expect(onClose).toHaveBeenCalled()
  })

  it('boton Refresh dispara nueva consulta', async () => {
    fetchSpy.mockResolvedValue(makeOkResponse())
    render(<SystemHealthModal onClose={() => {}} />)
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByLabelText('Refrescar ahora'))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))
  })

  it('agrega entradas al historial tras cada fetch', async () => {
    fetchSpy.mockResolvedValue(makeOkResponse())
    render(<SystemHealthModal onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/Historial reciente \(1\)/)).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Refrescar ahora'))
    await waitFor(() => expect(screen.getByText(/Historial reciente \(2\)/)).toBeTruthy())
  })

  it('toggle auto-refresh cambia el label', async () => {
    fetchSpy.mockResolvedValue(makeOkResponse())
    render(<SystemHealthModal onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Activo')).toBeTruthy())
    fireEvent.click(screen.getByText('Activo'))
    expect(screen.getByText('Pausado')).toBeTruthy()
  })
})
