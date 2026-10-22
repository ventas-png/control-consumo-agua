// Regresión react-hooks/exhaustive-deps en los tabs del portal residente que
// cargaban con una función suelta y una lista de deps escrita a mano:
//   - PortalTransparenciaTab:50 (useEffect ← 'cargar')
// Ahora `cargar` es un useCallback con sus dependencias reales y el efecto la
// declara. (PortalAsambleasTab tiene su propia suite: PortalAsambleasTab.test.tsx.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'

const h = vi.hoisted(() => ({
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
  fetchFondoReservaAprobado: h.fetchFondoReservaAprobado,
  fetchFondoReservaMovimientos: h.fetchFondoReservaMovimientos,
  fetchPresupuestosAnio: h.fetchPresupuestosAnio,
  fetchGastosAnioMontos: h.fetchGastosAnioMontos,
}))

const { PortalTransparenciaTab } = await import('../PortalTransparenciaTab')

beforeEach(() => {
  Object.values(h).forEach(m => m.mockClear())
})

afterEach(cleanup)

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
