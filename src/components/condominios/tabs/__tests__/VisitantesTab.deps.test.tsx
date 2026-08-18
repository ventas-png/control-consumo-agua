// Regresión react-hooks/exhaustive-deps (VisitantesTab:85).
//
// `rangosDeFecha()` se llamaba sin argumento en cada render, devolviendo un
// objeto nuevo; `hoy` salía de ahí y el efecto que precarga los huéspedes
// pre-registrados lo leía SIN declararlo (declararlo lo habría disparado en
// cada render). Ahora el rango se ancla al día — estable dentro del día, nuevo
// al cruzar la medianoche — y el efecto cancela respuestas fuera de orden.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import type { ReservaSTR, Unidad, Visitante } from '../../../../types'

const h = vi.hoisted(() => ({ fetchHuespedesByReservas: vi.fn(async (): Promise<unknown[]> => []) }))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../lib/storageUrls', () => ({
  useSignedUrl: (src: string | null) => (src ? `https://firmado.test/${src}` : null),
}))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRowsByIds: vi.fn(async () => ({ error: null })),
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({
  fetchHuespedesByReservas: h.fetchHuespedesByReservas,
}))
vi.mock('../../../../lib/validatedInsert', () => ({
  validatedInsert: vi.fn(async () => ({ error: null })),
  validatedInsertMany: vi.fn(async () => ({ error: null })),
}))
vi.mock('../exportUtils', () => ({ exportarPDFTabla: vi.fn(), exportarExcel: vi.fn() }))

const { VisitantesTab } = await import('../VisitantesTab')

const unidades = [{ id: 'u1', nombre: 'Apto. 2A', activo: true }] as unknown as Unidad[]

function reserva(id: string, salida: string): ReservaSTR {
  return {
    id, unidad_id: 'u1', estado: 'confirmada',
    fecha_entrada: '2026-08-10', fecha_salida: salida,
    huesped_nombre: `Huésped ${id}`, plataforma: 'directo',
  } as unknown as ReservaSTR
}

function tab(reservasSTR: ReservaSTR[], visitantes: Visitante[] = []) {
  return (
    <VisitantesTab
      visitantes={visitantes} unidades={unidades} reservasSTR={reservasSTR}
      solicitudesMudanza={[]} proyectoId="p1" companyId="c1" userId="usr-1"
      canCreate onRefresh={() => {}}
    />
  )
}

/** Abre el modal de check-in por reserva STR. */
function abrirModalStr() {
  fireEvent.click(screen.getByText('🏠 Renta corta'))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 7, 18, 14, 30, 0))
  h.fetchHuespedesByReservas.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('VisitantesTab — el rango de fechas está anclado al día', () => {
  it('al abrir el modal STR precarga los huéspedes de las reservas VIGENTES hoy', async () => {
    render(tab([reserva('r-vigente', '2026-08-25'), reserva('r-vencida', '2026-08-01')]))
    await act(async () => { abrirModalStr() })

    expect(h.fetchHuespedesByReservas).toHaveBeenCalledWith(['r-vigente'])
  })

  it('NO vuelve a consultar al re-renderizar con las mismas reservas (sin ciclo)', async () => {
    const reservas = [reserva('r1', '2026-08-25')]
    const { rerender } = render(tab(reservas))
    await act(async () => { abrirModalStr() })
    expect(h.fetchHuespedesByReservas).toHaveBeenCalledTimes(1)

    rerender(tab(reservas))
    rerender(tab(reservas))
    await act(async () => {})

    expect(h.fetchHuespedesByReservas).toHaveBeenCalledTimes(1)
  })

  it('al cambiar el día reevalúa qué reservas siguen vigentes', async () => {
    // Sale el 18/ago: vigente hoy, ya no el 19.
    render(tab([reserva('r-hoy', '2026-08-18'), reserva('r-larga', '2026-08-25')]))
    await act(async () => { abrirModalStr() })
    expect(h.fetchHuespedesByReservas).toHaveBeenLastCalledWith(['r-hoy', 'r-larga'])

    await act(async () => { vi.advanceTimersByTime(9.5 * 3600 * 1000 + 1000) })

    expect(h.fetchHuespedesByReservas).toHaveBeenLastCalledWith(['r-larga'])
  })

  it('descarta la respuesta en vuelo cuando el efecto se relanza (cleanup)', async () => {
    let resolverPrimera: (v: unknown[]) => void = () => {}
    h.fetchHuespedesByReservas.mockImplementationOnce(() => new Promise(res => { resolverPrimera = res }))
    h.fetchHuespedesByReservas.mockImplementationOnce(async () => [
      { id: 'h2', reserva_str_id: 'r2', nombre: 'VIGENTE', identificacion: '2' },
    ])

    const { rerender } = render(tab([reserva('r1', '2026-08-25')]))
    await act(async () => { abrirModalStr() })

    // Llegan reservas nuevas: el cleanup cancela la petición anterior.
    await act(async () => { rerender(tab([reserva('r2', '2026-08-26')])) })
    expect(screen.getByText(/VIGENTE/)).toBeTruthy()

    // La respuesta vieja resuelve TARDE: no debe pisar a la vigente.
    await act(async () => {
      resolverPrimera([{ id: 'h1', reserva_str_id: 'r1', nombre: 'TARDÍO', identificacion: '1' }])
    })

    expect(screen.queryByText(/TARDÍO/)).toBeNull()
    expect(screen.getByText(/VIGENTE/)).toBeTruthy()
  })
})
