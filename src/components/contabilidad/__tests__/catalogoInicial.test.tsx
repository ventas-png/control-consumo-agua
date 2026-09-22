import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CuentaContable } from '../../../types/contabilidad'

const state = vi.hoisted(() => ({
  cuentas: [] as CuentaContable[],
  puedeCrear: true,
  inicializar: vi.fn(async () => [{ cuentas_creadas: 22, mapeos_creados: 26 }]),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../../domain/contabilidad/queries', () => ({
  useCuentasQuery: () => ({ data: state.cuentas, isLoading: false }),
}))
vi.mock('../../../domain/contabilidad/mutations', () => ({
  useCrearCuentaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useActualizarCuentaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEliminarCuentasMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useInicializarCatalogoMutation: () => ({ mutateAsync: state.inicializar, isPending: false }),
  useImportarCuentasMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  fetchCuentasEnUso: vi.fn(async () => []),
}))
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  usePermisosContabilidad: () => ({
    puedeCrear: state.puedeCrear,
    puedeEditar: true,
    puedeCambiarEstado: true,
    puedeAutorizar: true,
    puedeEliminar: true,
  }),
}))
vi.mock('../../shared/Dialog', () => ({
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

import { CatalogoCuentasTab } from '../CatalogoCuentasTab'

function montar() {
  render(<CatalogoCuentasTab companyId="c1" projectId={null} monedaBase="GTQ" proyectos={[]} />)
}

beforeEach(() => {
  state.cuentas = []
  state.puedeCrear = true
  state.inicializar.mockClear()
})
afterEach(cleanup)

describe('CatalogoCuentasTab — inicio configurable', () => {
  it('ofrece básico, LATAM o empezar en limpio cuando el ledger está vacío', () => {
    montar()
    expect(screen.getByText('Elige cómo iniciar esta contabilidad')).toBeTruthy()
    expect(screen.getByText('Usar básico (recomendado)')).toBeTruthy()
    expect(screen.getByText('Usar catálogo completo')).toBeTruthy()
    expect(screen.getByText('+ Primera cuenta')).toBeTruthy()
    expect(screen.getByText('📥 Importar')).toBeTruthy()
  })

  it('inicializa la plantilla básica sólo después de confirmar', async () => {
    montar()
    fireEvent.click(screen.getByText('Usar básico (recomendado)'))
    await waitFor(() => expect(state.inicializar).toHaveBeenCalledWith('basico'))
  })

  it('no ofrece inicialización si el usuario no puede crear', () => {
    state.puedeCrear = false
    montar()
    expect(screen.queryByText('Elige cómo iniciar esta contabilidad')).toBeNull()
    expect(screen.getByText(/Un administrador debe crear o importar/i)).toBeTruthy()
  })

  it('oculta el asistente cuando el catálogo ya tiene cuentas', () => {
    state.cuentas = [{
      id: 'cta-1', company_id: 'c1', project_id: null, codigo: '1', nombre: 'Activo',
      tipo: 'activo', naturaleza: 'deudora', padre_id: null, nivel: 1,
      es_detalle: false, activa: true, es_sistema: false, moneda: null,
      descripcion: null, created_at: '', updated_at: '',
    } as CuentaContable]
    montar()
    expect(screen.queryByText('Elige cómo iniciar esta contabilidad')).toBeNull()
    expect(screen.getByText('+ Nueva cuenta')).toBeTruthy()
  })
})
