// Borrar cuentas del catálogo: individual y por selección.
//
// La guarda real es la BD (FK RESTRICT + trigger para las del seed). Esto fija
// lo que la UI debe ofrecer y lo que no: una cuenta del catálogo base nunca
// muestra "Eliminar", y sin permiso de borrado no hay ni casillas ni acción.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import type { CuentaContable } from '../../../types/contabilidad'

const state = vi.hoisted(() => ({
  cuentas: [] as CuentaContable[],
  permisos: { puedeCrear: true, puedeEditar: true, puedeCambiarEstado: true, puedeAutorizar: true, puedeEliminar: true },
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../../domain/contabilidad/queries', () => ({
  useCuentasQuery: () => ({ data: state.cuentas, isLoading: false }),
}))
vi.mock('../../../domain/contabilidad/mutations', () => ({
  useCrearCuentaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useActualizarCuentaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEliminarCuentasMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportarCuentasMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  fetchCuentasEnUso: vi.fn(async () => []),
}))
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  usePermisosContabilidad: () => state.permisos,
}))

import { CatalogoCuentasTab } from '../CatalogoCuentasTab'

function cuenta(id: string, codigo: string, es_sistema: boolean): CuentaContable {
  return {
    id, codigo, nombre: `Cuenta ${codigo}`,
    company_id: 'c1', project_id: null,
    tipo: 'gasto', naturaleza: 'deudora', padre_id: null, nivel: 3,
    es_detalle: true, activa: true, es_sistema, moneda: null, descripcion: null,
    created_at: '', updated_at: '',
  } as CuentaContable
}

function montar() {
  render(<CatalogoCuentasTab companyId="c1" projectId={null} monedaBase="GTQ" proyectos={[]} />)
}

beforeEach(() => {
  state.cuentas = [cuenta('a', '5201', false), cuenta('b', '1101', true)]
  state.permisos = { puedeCrear: true, puedeEditar: true, puedeCambiarEstado: true, puedeAutorizar: true, puedeEliminar: true }
})
afterEach(cleanup)

describe('CatalogoCuentasTab — borrado', () => {
  it('ofrece Eliminar en la cuenta del usuario y no en la del catálogo base', () => {
    montar()
    // Solo una de las dos cuentas trae el botón.
    expect(screen.getAllByText('Eliminar')).toHaveLength(1)
    expect(screen.getByLabelText('Seleccionar 5201 Cuenta 5201')).toBeTruthy()
  })

  it('muestra las casillas de selección y el "seleccionar todas"', () => {
    montar()
    expect(screen.getByLabelText('Seleccionar todas las cuentas visibles')).toBeTruthy()
    expect(screen.getByLabelText('Seleccionar 1101 Cuenta 1101')).toBeTruthy()
  })

  it('sin permiso de borrado no hay casillas ni acción de eliminar', () => {
    state.permisos = { ...state.permisos, puedeEliminar: false }
    montar()
    expect(screen.queryByText('Eliminar')).toBeNull()
    expect(screen.queryByLabelText('Seleccionar todas las cuentas visibles')).toBeNull()
    expect(screen.queryByLabelText('Seleccionar 5201 Cuenta 5201')).toBeNull()
  })
})
