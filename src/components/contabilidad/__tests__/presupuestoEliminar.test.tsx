// Eliminar un presupuesto solo se ofrece mientras NO esté autorizado.
//
// Un presupuesto aprobado (o su versión archivada) sostiene el comparativo vs
// real y las alertas de partida excedida, y su borrado es en cascada sobre las
// partidas: irreversible. La guarda de verdad es el trigger
// presupuesto_proteger_borrado; esto fija que la UI no llegue siquiera a
// ofrecer el botón, que es lo que evita el susto.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import type { PresupuestoConPartidas } from '../../../types/presupuesto'

const state = vi.hoisted(() => ({
  presupuestos: [] as PresupuestoConPartidas[],
  permisos: { puedeCrear: true, puedeEditar: true, puedeCambiarEstado: true, puedeAutorizar: true, puedeEliminar: true },
  eliminados: [] as string[],
}))

// El barril de `../shared` arrastra el cliente de Supabase, que exige las env
// vars VITE_SUPABASE_* inexistentes en test.
vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))

vi.mock('../../../domain/presupuesto/queries', () => ({
  usePresupuestosQuery: () => ({ data: state.presupuestos, isLoading: false }),
  usePartidasQuery: () => ({ data: [], isLoading: false }),
  usePresupuestoVsRealQuery: () => ({ data: [], isLoading: false }),
}))
vi.mock('../../../domain/presupuesto/mutations', () => ({
  useCrearPresupuestoMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGuardarPartidasMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCambiarEstadoPresupuestoMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEliminarPresupuestoMutation: () => ({
    mutateAsync: vi.fn(async (id: string) => { state.eliminados.push(id) }),
    isPending: false,
  }),
}))
vi.mock('../../../domain/contabilidad/queries', () => ({
  useCuentasQuery: () => ({ data: [], isLoading: false }),
}))
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  usePermisosContabilidad: () => state.permisos,
}))

import { PresupuestoTab } from '../PresupuestoTab'

function presupuesto(
  id: string,
  estado: PresupuestoConPartidas['estado'],
  nombre = `Presupuesto ${id}`,
): PresupuestoConPartidas {
  return {
    id, nombre, estado,
    company_id: 'c1', project_id: null, anio: 2026,
    notas: null, aprobado_por: null, aprobado_at: null, created_by: null,
    created_at: '', updated_at: '',
    presupuesto_partidas: [],
  } as PresupuestoConPartidas
}

function montar() {
  render(<PresupuestoTab companyId="c1" projectId={null} proyectos={[]} monedaBase="GTQ" />)
}

beforeEach(() => {
  state.eliminados = []
  state.permisos = { puedeCrear: true, puedeEditar: true, puedeCambiarEstado: true, puedeAutorizar: true, puedeEliminar: true }
})
afterEach(cleanup)

describe('PresupuestoTab — eliminar', () => {
  it('ofrece eliminar un borrador y un propuesto', () => {
    state.presupuestos = [presupuesto('p1', 'borrador'), presupuesto('p2', 'propuesto')]
    montar()
    expect(screen.getAllByText('Eliminar')).toHaveLength(2)
  })

  it('NO ofrece eliminar un presupuesto aprobado ni uno archivado', () => {
    state.presupuestos = [presupuesto('p1', 'aprobado'), presupuesto('p2', 'archivado')]
    montar()
    expect(screen.queryByText('Eliminar')).toBeNull()
  })

  it('respeta el permiso de borrado del rol', () => {
    state.presupuestos = [presupuesto('p1', 'borrador')]
    state.permisos = { ...state.permisos, puedeEliminar: false }
    montar()
    expect(screen.queryByText('Eliminar')).toBeNull()
  })
})
