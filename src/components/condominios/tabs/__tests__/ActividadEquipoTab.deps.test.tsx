// Regresión react-hooks/exhaustive-deps (ActividadEquipoTab:42, dos avisos).
//
// `const filas = data ?? []` creaba un array nuevo en cada render, de modo que
// los dos useMemo que lo consumen (totales e inactivos) se recalculaban SIEMPRE:
// memoización inútil sobre una tabla que puede traer decenas de filas. Además
// `hasta` era `useMemo(() => hoyLocalISO(), [])`, es decir la fecha CONGELADA
// del primer render: la consulta seguía pidiendo "hasta ayer" de madrugada.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ActividadUsuario } from '../../../../domain/condominios/actividad'

const h = vi.hoisted(() => ({ useActividadEquipo: vi.fn() }))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/actividad', () => ({
  useActividadEquipo: h.useActividadEquipo,
}))

const ActividadEquipoTab = (await import('../ActividadEquipoTab')).default

function fila(over: Partial<ActividadUsuario> = {}): ActividadUsuario {
  return {
    usuario_id: 'u1', usuario_nombre: 'Lecturista Ana', usuario_rol: 'lecturista',
    lecturas: 5, lecturas_m3: 50, limpiezas: 0, checklists: 0,
    rondas_iniciadas: 0, puntos_marcados: 0, visitas_registradas: 0, paquetes: 0,
    solicitudes_creadas: 0, tareas_cerradas: 0, total: 5,
    ultima_actividad: '2026-08-17T10:00:00.000Z',
    ...over,
  }
}

function resultado(data: ActividadUsuario[] | undefined) {
  return { data, isLoading: false, isError: false, error: null }
}

// La tabla pinta <UsuarioChip>, que resuelve nombres con un useQuery real.
function conQueryClient(nodo: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{nodo}</QueryClientProvider>
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 7, 18, 14, 30, 0))
  h.useActividadEquipo.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('ActividadEquipoTab — `filas` estable y `hasta` reactivo', () => {
  it('consulta el rango con la fecha de HOY como extremo superior', () => {
    h.useActividadEquipo.mockReturnValue(resultado([]))
    render(<ActividadEquipoTab proyectoId="p1" companyId="c1" />)

    expect(h.useActividadEquipo).toHaveBeenLastCalledWith('p1', '2026-07-19', '2026-08-18')
  })

  it('al cruzar la medianoche vuelve a consultar con el rango del día NUEVO', () => {
    h.useActividadEquipo.mockReturnValue(resultado([]))
    render(<ActividadEquipoTab proyectoId="p1" companyId="c1" />)

    act(() => { vi.advanceTimersByTime(9.5 * 3600 * 1000 + 1000) })

    expect(h.useActividadEquipo).toHaveBeenLastCalledWith('p1', '2026-07-19', '2026-08-19')
  })

  it('con `data` undefined trata las filas como lista vacía sin romper los totales', () => {
    h.useActividadEquipo.mockReturnValue(resultado(undefined))
    render(<ActividadEquipoTab proyectoId="p1" companyId="c1" />)

    expect(screen.getByText('Sin actividad registrada en el período')).toBeTruthy()
  })

  it('los totales se recalculan cuando `data` cambia de verdad', () => {
    h.useActividadEquipo.mockReturnValue(resultado([fila({ lecturas: 5, total: 5 })]))
    const { rerender } = render(conQueryClient(<ActividadEquipoTab proyectoId="p1" companyId="c1" />))
    expect(screen.getAllByText('5').length).toBeGreaterThan(0)

    h.useActividadEquipo.mockReturnValue(resultado([fila({ lecturas: 9, total: 9 })]))
    rerender(conQueryClient(<ActividadEquipoTab proyectoId="p1" companyId="c1" />))

    expect(screen.getAllByText('9').length).toBeGreaterThan(0)
    expect(screen.queryByText('5')).toBeNull()
  })

  it('re-renderizar con el MISMO `data` no cambia la salida (el memo memoiza)', () => {
    const data = [fila()]
    h.useActividadEquipo.mockReturnValue(resultado(data))
    const { rerender } = render(conQueryClient(<ActividadEquipoTab proyectoId="p1" companyId="c1" />))
    const antes = document.body.innerHTML

    h.useActividadEquipo.mockReturnValue(resultado(data))
    rerender(conQueryClient(<ActividadEquipoTab proyectoId="p1" companyId="c1" />))

    expect(document.body.innerHTML).toBe(antes)
  })
})
