import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { HorasPersonal } from '../../../../types'

const mocks = vi.hoisted(() => ({
  fetchHorasPersonal: vi.fn(async () => [] as HorasPersonal[]),
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: () => ({}), rpc: () => ({}) },
  db: { from: () => ({}), rpc: () => ({}) },
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({
  fetchHorasPersonal: mocks.fetchHorasPersonal,
}))

const HorasExtraTab = (await import('../HorasExtraTab')).default

function fila(over: Partial<HorasPersonal> = {}): HorasPersonal {
  return {
    personal_id: 'emp1', nombre: 'Pedro Guardia', cargo: 'guardia',
    dias_planificados: 22, dias_trabajados: 21, dias_ausencia: 1,
    dias_asueto_trabajado: 0, tardanzas: 2,
    horas_planificadas: 176, horas_trabajadas: 182,
    horas_ordinarias: 168, horas_extra: 14,
    horas_nocturnas: 96, horas_asueto: 0, horas_asueto_ponderadas: 0,
    ...over,
  }
}

beforeEach(() => {
  mocks.fetchHorasPersonal.mockClear()
  mocks.fetchHorasPersonal.mockResolvedValue([fila()])
})

afterEach(() => { cleanup() })

describe('HorasExtraTab — horario normal y horas extras', () => {
  it('pide el consolidado del mes en curso al montar', async () => {
    render(<HorasExtraTab proyectoId="p1" />)
    await waitFor(() => expect(mocks.fetchHorasPersonal).toHaveBeenCalledTimes(1))
    const [proyecto, desde, hasta] = mocks.fetchHorasPersonal.mock.calls[0] as unknown as [string, string, string]
    expect(proyecto).toBe('p1')
    // El rango es el mes completo, del 1 al último día real.
    expect(desde.endsWith('-01')).toBe(true)
    expect(hasta > desde).toBe(true)
  })

  it('muestra ordinarias y extra por empleado', async () => {
    render(<HorasExtraTab proyectoId="p1" />)
    expect(await screen.findByText('Pedro Guardia')).toBeTruthy()
    // Acotado a la tabla: con un solo empleado los KPI de arriba repiten las
    // mismas cifras, y la aserción tiene que leer la FILA.
    const tabla = within(screen.getByRole('table'))
    expect(tabla.getByText('168h')).toBeTruthy()
    expect(tabla.getByText('14h')).toBeTruthy()
  })

  it('recalcula al cambiar de mes', async () => {
    render(<HorasExtraTab proyectoId="p1" />)
    await waitFor(() => expect(mocks.fetchHorasPersonal).toHaveBeenCalledTimes(1))
    const primerDesde = (mocks.fetchHorasPersonal.mock.calls[0] as unknown as [string, string, string])[1]

    fireEvent.click(screen.getByLabelText('Mes anterior'))
    await waitFor(() => expect(mocks.fetchHorasPersonal).toHaveBeenCalledTimes(2))
    const segundoDesde = (mocks.fetchHorasPersonal.mock.calls[1] as unknown as [string, string, string])[1]
    expect(segundoDesde < primerDesde).toBe(true)
  })

  it('el asueto trabajado se muestra junto a su valor ponderado', async () => {
    mocks.fetchHorasPersonal.mockResolvedValue([
      fila({ dias_asueto_trabajado: 1, horas_asueto: 8, horas_asueto_ponderadas: 16 }),
    ])
    render(<HorasExtraTab proyectoId="p1" />)
    expect(await screen.findByText(/→ 16h/)).toBeTruthy()
  })

  it('un error de permisos se distingue de "no hay datos"', async () => {
    // La RPC exige el permiso del tab: concluir "el mes está vacío" cuando en
    // realidad no hay acceso sería un error de lectura caro.
    mocks.fetchHorasPersonal.mockRejectedValue(new Error('no autorizado'))
    render(<HorasExtraTab proyectoId="p1" />)
    expect(await screen.findByText('No se pudieron calcular las horas')).toBeTruthy()
    expect(screen.getByText('no autorizado')).toBeTruthy()
  })

  it('explica el estado vacío cuando no hay jornada registrada', async () => {
    mocks.fetchHorasPersonal.mockResolvedValue([])
    render(<HorasExtraTab proyectoId="p1" />)
    expect(await screen.findByText(/Sin jornada registrada en/)).toBeTruthy()
  })

  it('sin filas no ofrece exportar', async () => {
    mocks.fetchHorasPersonal.mockResolvedValue([])
    render(<HorasExtraTab proyectoId="p1" />)
    await screen.findByText(/Sin jornada registrada en/)
    expect(screen.queryByText('Exportar')).toBeNull()
  })
})
