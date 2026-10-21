// Los chips del mapa (estados, calor, fijar centro) suman ~500px: en el
// teléfono tienen que bajar de línea en vez de quedar recortados por la tarjeta.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  fetchMapCenter: vi.fn(async () => null),
  saveMapCenter: vi.fn(async () => ({ error: null })),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../../domain/mapa/queries', () => ({
  fetchMapCenter: mocks.fetchMapCenter,
  saveMapCenter: mocks.saveMapCenter,
}))
vi.mock('../../shared/Dialog', () => ({ notify: vi.fn() }))
// Leaflet no corre sobre jsdom: el mapa se sustituye por un marcador de posición.
vi.mock('../MapView', () => ({ MapView: () => <div data-testid="mapa" /> }))

const { MapaSection } = await import('../MapaSection')

afterEach(cleanup)

describe('MapaSection — chips en el teléfono', () => {
  it('la fila de chips envuelve y los chips siguen funcionando', async () => {
    render(<MapaSection clientes={[]} registros={[]} companyId="co1" canConfigurar />)
    const fijar = await screen.findByRole('button', { name: /Fijar centro/ })
    const fila = fijar.parentElement!
    expect(fila.style.display).toBe('flex')
    expect(fila.style.flexWrap).toBe('wrap')

    const mora = screen.getByRole('button', { name: '🔴 Mora' })
    expect(mora.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(mora)
    expect(mora.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(fijar)
    await waitFor(() => expect(mocks.saveMapCenter).toHaveBeenCalledWith('co1', expect.objectContaining({ zoom_default: expect.any(Number) })))
  })

  it('sin permiso de configurar no aparece "Fijar centro"', async () => {
    render(<MapaSection clientes={[]} registros={[]} companyId="co1" />)
    expect(await screen.findByTestId('mapa')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Fijar centro/ })).toBeNull()
  })
})
