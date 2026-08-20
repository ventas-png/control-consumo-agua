// Regresión react-hooks/exhaustive-deps (MultiCondominioTab:59).
//
// El efecto de carga dependía de `[proyectosActivos.length, companyId]` porque
// `proyectosActivos` era un `.filter()` sin memoizar. Consecuencias reales:
//   - cambiar la lista de proyectos SIN cambiar el conteo (activar uno y
//     desactivar otro, renombrar) no recargaba: comparativo desactualizado;
//   - `hoy` se leía de una closure vieja (cartera vencida calculada contra la
//     fecha de ayer si la pantalla quedaba abierta).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { StrictMode } from 'react'
import type { Proyecto } from '../../../../types'

const h = vi.hoisted(() => ({ fetchProyectosResumen: vi.fn() }))

vi.mock('../../../../domain/condominios/tabQueries', () => ({
  fetchProyectosResumen: h.fetchProyectosResumen,
}))

const MultiCondominioTab = (await import('../MultiCondominioTab')).default

function proyecto(id: string, nombre: string, estado = 'activo'): Proyecto {
  return { id, nombre, estado } as unknown as Proyecto
}

const DOS = [proyecto('p1', 'Torre A'), proyecto('p2', 'Torre B')]

function resumenVacio(ids: string[]) {
  return Object.fromEntries(ids.map(id => [id, { cuotas: [], tickets: [], unidadesCount: 0, visitantesCount: 0 }]))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 7, 18, 14, 30, 0))
  h.fetchProyectosResumen.mockReset()
  h.fetchProyectosResumen.mockImplementation(async (ids: string[]) => resumenVacio(ids))
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

function renderTab(proyectos: Proyecto[]) {
  return render(<MultiCondominioTab proyectos={proyectos} companyId="c1" moneda="Q" />)
}

describe('MultiCondominioTab — dependencias del efecto de carga', () => {
  it('carga el resumen de los proyectos activos', async () => {
    renderTab(DOS)
    await act(async () => {})
    expect(h.fetchProyectosResumen).toHaveBeenCalledWith(['p1', 'p2'], 'c1', '2026-08-18')
  })

  it('recarga cuando cambia la LISTA de proyectos aunque el conteo sea el mismo', async () => {
    const { rerender } = renderTab(DOS)
    await act(async () => {})
    expect(h.fetchProyectosResumen).toHaveBeenCalledTimes(1)

    // Mismo número de activos (2), distinta composición: antes esto NO recargaba.
    rerender(
      <MultiCondominioTab
        proyectos={[proyecto('p1', 'Torre A'), proyecto('p3', 'Torre C')]}
        companyId="c1" moneda="Q"
      />,
    )
    await act(async () => {})

    expect(h.fetchProyectosResumen).toHaveBeenCalledTimes(2)
    expect(h.fetchProyectosResumen).toHaveBeenLastCalledWith(['p1', 'p3'], 'c1', '2026-08-18')
  })

  it('NO recarga si se re-renderiza con el mismo array de proyectos', async () => {
    const { rerender } = renderTab(DOS)
    await act(async () => {})
    expect(h.fetchProyectosResumen).toHaveBeenCalledTimes(1)

    rerender(<MultiCondominioTab proyectos={DOS} companyId="c1" moneda="Q" />)
    rerender(<MultiCondominioTab proyectos={DOS} companyId="c1" moneda="Q" />)
    await act(async () => {})

    // Sin ciclo: el memo de `proyectosActivos` mantiene la identidad.
    expect(h.fetchProyectosResumen).toHaveBeenCalledTimes(1)
  })

  it('recarga con la fecha nueva al cruzar la medianoche', async () => {
    renderTab(DOS)
    await act(async () => {})
    expect(h.fetchProyectosResumen).toHaveBeenLastCalledWith(['p1', 'p2'], 'c1', '2026-08-18')

    await act(async () => { vi.advanceTimersByTime(9.5 * 3600 * 1000 + 1000) })
    await act(async () => {})

    expect(h.fetchProyectosResumen).toHaveBeenLastCalledWith(['p1', 'p2'], 'c1', '2026-08-19')
  })

  it('descarta una respuesta fuera de orden: gana siempre la última petición', async () => {
    let resolverPrimera: (v: unknown) => void = () => {}
    h.fetchProyectosResumen.mockImplementationOnce(
      () => new Promise(res => { resolverPrimera = res }),
    )
    h.fetchProyectosResumen.mockImplementationOnce(async () => ({
      p1: { cuotas: [], tickets: [], unidadesCount: 7, visitantesCount: 0 },
      p3: { cuotas: [], tickets: [], unidadesCount: 0, visitantesCount: 0 },
    }))

    const { rerender } = renderTab(DOS)
    rerender(
      <MultiCondominioTab
        proyectos={[proyecto('p1', 'Torre A'), proyecto('p3', 'Torre C')]}
        companyId="c1" moneda="Q"
      />,
    )
    await act(async () => {})
    expect(screen.getByText(/Torre C/)).toBeTruthy()

    // La primera respuesta llega TARDE: el cleanup ya la canceló.
    await act(async () => { resolverPrimera(resumenVacio(['p1', 'p2'])) })

    expect(screen.queryByText(/Torre B/)).toBeNull()
    expect(screen.getByText(/Torre C/)).toBeTruthy()
  })

  it('bajo StrictMode no deja efectos ni temporizadores colgando', async () => {
    const { unmount } = render(
      <StrictMode><MultiCondominioTab proyectos={DOS} companyId="c1" moneda="Q" /></StrictMode>,
    )
    await act(async () => {})
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
