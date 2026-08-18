// Regresión de la revisión sobre CondominiosSection:706.
//
// La primera corrección leía `unidades` desde un ref para no meterla en las
// dependencias del batch pesado. Eso silenciaba el aviso pero NO arreglaba el
// bug: actualizar un ref no vuelve a ejecutar nada, así que si las unidades
// llegaban (o cambiaban) después de la carga inicial, el calendario de
// cumpleaños se quedaba con los clientes del estado anterior — vacío incluido.
//
// La consulta vive ahora en `useClientesCumple`, con sus dependencias reales.
// Montar CondominiosSection en jsdom es inviable (batch de ~90 consultas y el
// barril de 191 tabs), así que se prueba la unidad extraída.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Unidad } from '../../../types'

const h = vi.hoisted(() => ({ fetchClientesConCumple: vi.fn() }))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../sectionData', () => ({ fetchClientesConCumple: h.fetchClientesConCumple }))

const {
  useClientesCumple, unidadesDelProyecto, clienteIdsDeUnidades, mapClientesCumple,
} = await import('../cumpleanos')

function unidad(id: string, projectId: string | null, clienteId: string | null): Unidad {
  return { id, nombre: `Apto. ${id}`, project_id: projectId, cliente_id: clienteId } as unknown as Unidad
}

const SIN_UNIDADES: Unidad[] = []

beforeEach(() => {
  h.fetchClientesConCumple.mockReset()
  h.fetchClientesConCumple.mockResolvedValue({ data: [] })
})

describe('derivaciones puras', () => {
  it('unidadesDelProyecto filtra por proyecto y devuelve vacío sin proyecto', () => {
    const us = [unidad('u1', 'p1', 'c1'), unidad('u2', 'p2', 'c2')]
    expect(unidadesDelProyecto(us, 'p1').map(u => u.id)).toEqual(['u1'])
    expect(unidadesDelProyecto(us, '')).toEqual([])
  })

  it('clienteIdsDeUnidades omite unidades sin cliente y deduplica', () => {
    const us = [unidad('u1', 'p1', 'c1'), unidad('u2', 'p1', null), unidad('u3', 'p1', 'c1')]
    expect(clienteIdsDeUnidades(us)).toEqual(['c1'])
  })

  it('mapClientesCumple empareja el nombre de la unidad y descarta sin fecha', () => {
    const us = [unidad('u1', 'p1', 'c1')]
    const filas = [
      { id: 'c1', nombre: 'Ana', fecha_nacimiento: '1990-08-18' },
      { id: 'c2', nombre: 'Sin fecha', fecha_nacimiento: null },
    ]
    expect(mapClientesCumple(filas, us)).toEqual([
      { id: 'c1', nombre: 'Ana', fecha_nacimiento: '1990-08-18', unidad_nombre: 'Apto. u1' },
    ])
  })
})

describe('useClientesCumple', () => {
  // EL caso de la revisión: vacío → unidades disponibles.
  it('consulta cuando las unidades llegan DESPUÉS del primer render', async () => {
    h.fetchClientesConCumple.mockResolvedValue({
      data: [{ id: 'c1', nombre: 'Ana', fecha_nacimiento: '1990-08-18' }],
    })

    const { result, rerender } = renderHook(
      ({ unidades }) => useClientesCumple(unidades, 'p1'),
      { initialProps: { unidades: SIN_UNIDADES } },
    )
    await act(async () => {})
    expect(h.fetchClientesConCumple).not.toHaveBeenCalled()
    expect(result.current).toEqual([])

    // El padre termina de cargar las unidades.
    rerender({ unidades: [unidad('u1', 'p1', 'c1')] })
    await act(async () => {})

    expect(h.fetchClientesConCumple).toHaveBeenCalledWith(['c1'])
    expect(result.current).toEqual([
      { id: 'c1', nombre: 'Ana', fecha_nacimiento: '1990-08-18', unidad_nombre: 'Apto. u1' },
    ])
  })

  it('vuelve a consultar cuando cambian las unidades del proyecto', async () => {
    const { rerender } = renderHook(
      ({ unidades }) => useClientesCumple(unidades, 'p1'),
      { initialProps: { unidades: [unidad('u1', 'p1', 'c1')] } },
    )
    await act(async () => {})
    expect(h.fetchClientesConCumple).toHaveBeenLastCalledWith(['c1'])

    rerender({ unidades: [unidad('u1', 'p1', 'c1'), unidad('u2', 'p1', 'c2')] })
    await act(async () => {})

    expect(h.fetchClientesConCumple).toHaveBeenLastCalledWith(['c1', 'c2'])
  })

  it('vuelve a consultar al cambiar de proyecto', async () => {
    const unidades = [unidad('u1', 'p1', 'c1'), unidad('u2', 'p2', 'c2')]
    const { rerender } = renderHook(
      ({ proyectoId }) => useClientesCumple(unidades, proyectoId),
      { initialProps: { proyectoId: 'p1' } },
    )
    await act(async () => {})
    expect(h.fetchClientesConCumple).toHaveBeenLastCalledWith(['c1'])

    rerender({ proyectoId: 'p2' })
    await act(async () => {})

    expect(h.fetchClientesConCumple).toHaveBeenLastCalledWith(['c2'])
  })

  it('NO consulta de nuevo al re-renderizar con las mismas unidades (sin ciclo)', async () => {
    const unidades = [unidad('u1', 'p1', 'c1')]
    const { rerender } = renderHook(() => useClientesCumple(unidades, 'p1'))
    await act(async () => {})
    rerender()
    rerender()
    await act(async () => {})

    expect(h.fetchClientesConCumple).toHaveBeenCalledTimes(1)
  })

  it('limpia el calendario cuando el proyecto se queda sin unidades con cliente', async () => {
    h.fetchClientesConCumple.mockResolvedValue({
      data: [{ id: 'c1', nombre: 'Ana', fecha_nacimiento: '1990-08-18' }],
    })
    const { result, rerender } = renderHook(
      ({ unidades }) => useClientesCumple(unidades, 'p1'),
      { initialProps: { unidades: [unidad('u1', 'p1', 'c1')] } },
    )
    await act(async () => {})
    expect(result.current).toHaveLength(1)

    rerender({ unidades: SIN_UNIDADES })
    await act(async () => {})

    expect(result.current).toEqual([])
  })

  it('descarta una respuesta atrasada del proyecto anterior', async () => {
    let resolverPrimera: (v: unknown) => void = () => {}
    h.fetchClientesConCumple.mockImplementationOnce(() => new Promise(res => { resolverPrimera = res }))
    h.fetchClientesConCumple.mockImplementationOnce(async () => ({
      data: [{ id: 'c2', nombre: 'VIGENTE', fecha_nacimiento: '1985-01-02' }],
    }))

    const unidades = [unidad('u1', 'p1', 'c1'), unidad('u2', 'p2', 'c2')]
    const { result, rerender } = renderHook(
      ({ proyectoId }) => useClientesCumple(unidades, proyectoId),
      { initialProps: { proyectoId: 'p1' } },
    )
    rerender({ proyectoId: 'p2' })
    await act(async () => {})
    expect(result.current.map(c => c.nombre)).toEqual(['VIGENTE'])

    // La respuesta de p1 llega TARDE: el cleanup ya la canceló.
    await act(async () => {
      resolverPrimera({ data: [{ id: 'c1', nombre: 'ATRASADO', fecha_nacimiento: '1990-08-18' }] })
    })

    expect(result.current.map(c => c.nombre)).toEqual(['VIGENTE'])
  })
})
