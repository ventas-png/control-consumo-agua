// Regresión react-hooks/exhaustive-deps (CondominiosDashboard:46).
//
// `proyectosActivos` era un `.filter()` sin memoizar, así que el efecto de
// autoselección se anclaba a `proyectosActivos.length`: si la lista pasaba de
// "un activo" a "otro activo distinto" (mismo conteo) el efecto no reaccionaba.
// Con el memo la dependencia es la lista real y no hay ciclo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import type { Proyecto, Unidad, UserSession } from '../../../types'

const h = vi.hoisted(() => ({
  fetchCondominioStatsForProject: vi.fn(async () => ({
    cuotasPendientes: 0, cuotasMora: 0, visitantesHoy: 0, ticketsAbiertos: 0, comunSinAsignar: 0,
  })),
  fetchCondominioStatsRows: vi.fn(async () => ({ cuotas: [], visitantes: [], tickets: [], conversations: [] })),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../domain/condominios/queries', () => ({
  fetchCondominioStatsForProject: h.fetchCondominioStatsForProject,
  fetchCondominioStatsRows: h.fetchCondominioStatsRows,
}))

const { CondominiosDashboard } = await import('../CondominiosDashboard')

const currentUser = { user_id: 'u1', company_id: 'emp-1', role: 'admin' } as unknown as UserSession
// Identidad estable: `cargarStats` (otro hook, ya con sus deps completas)
// depende de `unidades`, así que un literal `[]` inline recargaría por render y
// enmascararía lo que aquí se mide.
const SIN_UNIDADES: Unidad[] = []

function proyecto(id: string, nombre: string, estado = 'activo'): Proyecto {
  return { id, nombre, estado } as unknown as Proyecto
}

function dash(proyectos: Proyecto[]) {
  return (
    <CondominiosDashboard
      currentUser={currentUser} proyectos={proyectos} unidades={SIN_UNIDADES}
      onNavigateSection={() => {}}
    />
  )
}

beforeEach(() => {
  h.fetchCondominioStatsForProject.mockClear()
  h.fetchCondominioStatsRows.mockClear()
})

afterEach(cleanup)

describe('CondominiosDashboard — autoselección de proyecto', () => {
  it('con un solo proyecto activo lo selecciona y consulta sus stats', async () => {
    render(dash([proyecto('p1', 'Torre A')]))
    await act(async () => {})

    expect(h.fetchCondominioStatsForProject).toHaveBeenCalledWith('emp-1', 'p1')
  })

  it('espera a que lleguen los proyectos (lista vacía → un activo)', async () => {
    const { rerender } = render(dash([]))
    await act(async () => {})
    expect(h.fetchCondominioStatsForProject).not.toHaveBeenCalled()

    rerender(dash([proyecto('p1', 'Torre A')]))
    await act(async () => {})

    expect(h.fetchCondominioStatsForProject).toHaveBeenCalledWith('emp-1', 'p1')
  })

  it('no entra en bucle: el efecto se corta con `projectInitialized`', async () => {
    const proyectos = [proyecto('p1', 'Torre A')]
    const { rerender } = render(dash(proyectos))
    await act(async () => {})
    const llamadas = h.fetchCondominioStatsForProject.mock.calls.length

    rerender(dash(proyectos))
    rerender(dash(proyectos))
    await act(async () => {})

    expect(h.fetchCondominioStatsForProject.mock.calls.length).toBe(llamadas)
  })

  it('con varios activos no autoselecciona: agrega por proyecto', async () => {
    render(dash([proyecto('p1', 'Torre A'), proyecto('p2', 'Torre B')]))
    await act(async () => {})

    expect(h.fetchCondominioStatsForProject).not.toHaveBeenCalled()
    expect(h.fetchCondominioStatsRows).toHaveBeenCalledWith('emp-1')
  })

  it('ignora los proyectos inactivos al contar los activos', async () => {
    render(dash([proyecto('p1', 'Torre A'), proyecto('p2', 'Cerrado', 'inactivo')]))
    await act(async () => {})

    expect(h.fetchCondominioStatsForProject).toHaveBeenCalledWith('emp-1', 'p1')
  })
})
