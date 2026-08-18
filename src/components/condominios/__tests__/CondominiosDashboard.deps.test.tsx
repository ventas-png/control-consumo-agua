// Regresión react-hooks/exhaustive-deps (CondominiosDashboard:46).
//
// `proyectosActivos` era un `.filter()` sin memoizar, así que el efecto de
// autoselección se anclaba a `proyectosActivos.length`: si la lista pasaba de
// "un activo" a "otro activo distinto" (mismo conteo) el efecto no reaccionaba.
// Con el memo la dependencia es la lista real y no hay ciclo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
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

describe('CondominiosDashboard — reconciliación de la selección', () => {
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

  // (a) El caso que `projectInitialized` no cubría: la lista cambia de
  // composición manteniendo length=1, así que el efecto "una sola vez" dejaba
  // el dashboard pidiendo stats de un proyecto que ya no está en el selector.
  it('(a) [p1] → [p2] con length=1: reselecciona el proyecto vigente', async () => {
    const { rerender } = render(dash([proyecto('p1', 'Torre A')]))
    await act(async () => {})
    expect(h.fetchCondominioStatsForProject).toHaveBeenLastCalledWith('emp-1', 'p1')

    rerender(dash([proyecto('p2', 'Torre B')]))
    await act(async () => {})

    expect(h.fetchCondominioStatsForProject).toHaveBeenLastCalledWith('emp-1', 'p2')
  })

  // (b) El proyecto seleccionado desaparece (se archiva o se borra).
  it('(b) si el proyecto seleccionado deja de estar activo, la selección se corrige', async () => {
    const { rerender } = render(dash([proyecto('p1', 'Torre A'), proyecto('p2', 'Torre B')]))
    await act(async () => {})

    // Selección explícita del usuario sobre p1.
    await act(async () => { fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p1' } }) })
    expect(h.fetchCondominioStatsForProject).toHaveBeenLastCalledWith('emp-1', 'p1')

    // p1 se archiva: queda un único activo (p2) → pasa a ser el seleccionado.
    rerender(dash([proyecto('p1', 'Torre A', 'inactivo'), proyecto('p2', 'Torre B')]))
    await act(async () => {})

    expect(h.fetchCondominioStatsForProject).toHaveBeenLastCalledWith('emp-1', 'p2')
  })

  // (c) Una selección que sigue siendo válida NO se toca.
  it('(c) conserva una selección todavía válida al cambiar la lista', async () => {
    const { rerender } = render(dash([proyecto('p1', 'Torre A'), proyecto('p2', 'Torre B')]))
    await act(async () => {})
    await act(async () => { fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p2' } }) })
    expect(h.fetchCondominioStatsForProject).toHaveBeenLastCalledWith('emp-1', 'p2')

    // Entra un tercer proyecto; p2 sigue activo, así que la selección se respeta.
    rerender(dash([proyecto('p1', 'Torre A'), proyecto('p2', 'Torre B'), proyecto('p3', 'Torre C')]))
    await act(async () => {})

    expect(h.fetchCondominioStatsForProject).toHaveBeenLastCalledWith('emp-1', 'p2')
  })

  // (d) De uno a varios: la autoselección previa sigue siendo válida y se
  // conserva (no se cae a la vista agregada por el mero hecho de haber varios).
  it('(d) de un proyecto a varios: conserva el autoseleccionado', async () => {
    const { rerender } = render(dash([proyecto('p1', 'Torre A')]))
    await act(async () => {})
    expect(h.fetchCondominioStatsForProject).toHaveBeenLastCalledWith('emp-1', 'p1')

    rerender(dash([proyecto('p1', 'Torre A'), proyecto('p2', 'Torre B')]))
    await act(async () => {})

    expect(h.fetchCondominioStatsForProject).toHaveBeenLastCalledWith('emp-1', 'p1')
  })

  it('(d bis) de un proyecto a varios DISTINTOS: cae a la vista agregada', async () => {
    const { rerender } = render(dash([proyecto('p1', 'Torre A')]))
    await act(async () => {})
    expect(h.fetchCondominioStatsForProject).toHaveBeenLastCalledWith('emp-1', 'p1')

    // Ninguno de los nuevos es el seleccionado y hay más de uno → '' (agregado).
    rerender(dash([proyecto('p2', 'Torre B'), proyecto('p3', 'Torre C')]))
    await act(async () => {})

    expect(h.fetchCondominioStatsRows).toHaveBeenCalledWith('emp-1')
  })

  it('no entra en bucle: la actualización funcional devuelve el mismo valor', async () => {
    const proyectos = [proyecto('p1', 'Torre A')]
    const { rerender } = render(dash(proyectos))
    await act(async () => {})
    const llamadas = h.fetchCondominioStatsForProject.mock.calls.length

    rerender(dash(proyectos))
    rerender(dash(proyectos))
    await act(async () => {})

    expect(h.fetchCondominioStatsForProject.mock.calls.length).toBe(llamadas)
  })

  it('con varios activos y sin selección válida, agrega por proyecto', async () => {
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
