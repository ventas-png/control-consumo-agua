// Regresión react-hooks/exhaustive-deps en los dos tabs del portal residente
// que cargaban con una función suelta y una lista de deps escrita a mano:
//   - PortalAsambleasTab:64  (useEffect ← 'cargar')
//   - PortalTransparenciaTab:50 (useEffect ← 'cargar')
// Ahora `cargar` es un useCallback con sus dependencias reales y el efecto la
// declara; además cancela respuestas fuera de orden.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { StrictMode } from 'react'
import type { AsambleaDigital } from '../../../../types'

const h = vi.hoisted(() => ({
  fetchAsambleasDigital: vi.fn(async (): Promise<AsambleaDigital[]> => []),
  fetchPuntosByAsambleaIds: vi.fn(async (): Promise<unknown[]> => []),
  fetchVotosUnidad: vi.fn(async (): Promise<unknown[]> => []),
  fetchFondoReservaAprobado: vi.fn(async (): Promise<unknown[]> => []),
  fetchFondoReservaMovimientos: vi.fn(async (): Promise<unknown[]> => []),
  fetchPresupuestosAnio: vi.fn(async (): Promise<unknown[]> => []),
  fetchGastosAnioMontos: vi.fn(async (): Promise<unknown[]> => []),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({
  fetchAsambleasDigital: h.fetchAsambleasDigital,
  fetchPuntosByAsambleaIds: h.fetchPuntosByAsambleaIds,
  fetchVotosUnidad: h.fetchVotosUnidad,
  fetchFondoReservaAprobado: h.fetchFondoReservaAprobado,
  fetchFondoReservaMovimientos: h.fetchFondoReservaMovimientos,
  fetchPresupuestosAnio: h.fetchPresupuestosAnio,
  fetchGastosAnioMontos: h.fetchGastosAnioMontos,
}))

const { PortalAsambleasTab } = await import('../PortalAsambleasTab')
const { PortalTransparenciaTab } = await import('../PortalTransparenciaTab')

function asamblea(id: string, titulo: string): AsambleaDigital {
  return {
    id, titulo, estado: 'programada', modalidad: 'virtual',
    fecha: '2026-09-01T18:00:00.000Z',
  } as unknown as AsambleaDigital
}

beforeEach(() => {
  Object.values(h).forEach(m => m.mockClear())
})

afterEach(cleanup)

describe('PortalAsambleasTab — el efecto declara `cargar`', () => {
  it('recarga al cambiar de proyecto', async () => {
    const { rerender } = render(<PortalAsambleasTab unidadId="u1" proyectoId="p1" />)
    await act(async () => {})
    expect(h.fetchAsambleasDigital).toHaveBeenCalledWith('p1')

    rerender(<PortalAsambleasTab unidadId="u1" proyectoId="p2" />)
    await act(async () => {})

    expect(h.fetchAsambleasDigital).toHaveBeenCalledTimes(2)
    expect(h.fetchAsambleasDigital).toHaveBeenLastCalledWith('p2')
  })

  it('recarga al cambiar de unidad (los votos son por unidad)', async () => {
    h.fetchAsambleasDigital.mockResolvedValue([asamblea('a1', 'Ordinaria')])
    const { rerender } = render(<PortalAsambleasTab unidadId="u1" proyectoId="p1" />)
    await act(async () => {})
    expect(h.fetchVotosUnidad).toHaveBeenLastCalledWith('u1')

    rerender(<PortalAsambleasTab unidadId="u2" proyectoId="p1" />)
    await act(async () => {})

    expect(h.fetchVotosUnidad).toHaveBeenLastCalledWith('u2')
  })

  it('NO recarga al re-renderizar con las mismas props (sin ciclo)', async () => {
    const { rerender } = render(<PortalAsambleasTab unidadId="u1" proyectoId="p1" />)
    await act(async () => {})
    rerender(<PortalAsambleasTab unidadId="u1" proyectoId="p1" />)
    rerender(<PortalAsambleasTab unidadId="u1" proyectoId="p1" />)
    await act(async () => {})

    expect(h.fetchAsambleasDigital).toHaveBeenCalledTimes(1)
  })

  it('descarta la respuesta del proyecto abandonado (fuera de orden)', async () => {
    let resolverPrimera: (v: AsambleaDigital[]) => void = () => {}
    h.fetchAsambleasDigital.mockImplementationOnce(() => new Promise(res => { resolverPrimera = res }))
    h.fetchAsambleasDigital.mockImplementationOnce(async () => [asamblea('a2', 'Asamblea del proyecto NUEVO')])

    const { rerender } = render(<PortalAsambleasTab unidadId="u1" proyectoId="p1" />)
    rerender(<PortalAsambleasTab unidadId="u1" proyectoId="p2" />)
    await act(async () => {})
    expect(screen.getByText(/proyecto NUEVO/)).toBeTruthy()

    await act(async () => { resolverPrimera([asamblea('a1', 'Asamblea del proyecto VIEJO')]) })

    expect(screen.queryByText(/proyecto VIEJO/)).toBeNull()
    expect(screen.getByText(/proyecto NUEVO/)).toBeTruthy()
  })

  it('bajo StrictMode el doble montaje no duplica el estado visible', async () => {
    h.fetchAsambleasDigital.mockResolvedValue([asamblea('a1', 'Ordinaria 2026')])
    render(<StrictMode><PortalAsambleasTab unidadId="u1" proyectoId="p1" /></StrictMode>)
    await act(async () => {})

    expect(screen.getAllByText(/Ordinaria 2026/)).toHaveLength(1)
  })
})

describe('PortalTransparenciaTab — el efecto declara `cargar`', () => {
  it('recarga al cambiar de proyecto y no en cada render', async () => {
    const { rerender } = render(<PortalTransparenciaTab proyectoId="p1" moneda="Q" />)
    await act(async () => {})
    expect(h.fetchFondoReservaAprobado).toHaveBeenCalledTimes(1)

    rerender(<PortalTransparenciaTab proyectoId="p1" moneda="Q" />)
    await act(async () => {})
    expect(h.fetchFondoReservaAprobado).toHaveBeenCalledTimes(1)

    rerender(<PortalTransparenciaTab proyectoId="p2" moneda="Q" />)
    await act(async () => {})
    expect(h.fetchFondoReservaAprobado).toHaveBeenCalledTimes(2)
    expect(h.fetchFondoReservaAprobado).toHaveBeenLastCalledWith('p2')
  })

  it('descarta los KPIs del proyecto abandonado (fuera de orden)', async () => {
    let resolverPrimera: (v: unknown[]) => void = () => {}
    h.fetchFondoReservaMovimientos.mockImplementationOnce(() => new Promise(res => { resolverPrimera = res }))
    h.fetchFondoReservaMovimientos.mockImplementationOnce(async () => [
      { id: 'm1', tipo: 'aportacion', monto: 500, fecha: '2026-08-01', concepto: 'Cuota' },
    ])

    const { rerender } = render(<PortalTransparenciaTab proyectoId="p1" moneda="Q" />)
    rerender(<PortalTransparenciaTab proyectoId="p2" moneda="Q" />)
    await act(async () => {})

    await act(async () => {
      resolverPrimera([{ id: 'm0', tipo: 'aportacion', monto: 999999, fecha: '2026-07-01', concepto: 'VIEJO' }])
    })

    expect(screen.queryByText(/VIEJO/)).toBeNull()
    expect(screen.getByText(/Cuota/)).toBeTruthy()
  })
})
