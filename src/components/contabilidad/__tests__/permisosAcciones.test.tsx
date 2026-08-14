// Las acciones de Contabilidad se gatean por permiso RBAC, no por rol base.
//
// Regresión: la sección entera vivía detrás de un RoleGuard de admin, así que
// ningún botón consultaba permisos. Al abrir la ruta al permiso RBAC
// (platform.contabilidad.*), un rol con solo `view` habría visto todos los
// botones de escritura y la RLS los habría rechazado en la base.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import type { CuentaContable } from '../../../types/contabilidad'
import type { UserSession } from '../../../types'

const state = vi.hoisted(() => ({ cuentas: [] as CuentaContable[] }))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../../domain/contabilidad/queries', () => ({
  useCuentasQuery: () => ({ data: state.cuentas, isLoading: false }),
}))
vi.mock('../../../domain/contabilidad/mutations', () => ({
  useCrearCuentaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useActualizarCuentaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEliminarCuentasMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  fetchCuentasEnUso: vi.fn(async () => []),
}))

import { CatalogoCuentasTab } from '../CatalogoCuentasTab'
import { SessionProvider } from '../../shared/SessionContext'
import { PermissionsProvider } from '../../shared/PermissionsContext'

function cuenta(): CuentaContable {
  return {
    id: 'cta-1', codigo: '1102-01', nombre: 'Banco', company_id: 'c1', project_id: null,
    tipo: 'activo', naturaleza: 'deudora', padre_id: null, nivel: 4,
    es_detalle: true, activa: true, es_sistema: false, moneda: null,
    created_at: '', updated_at: '',
  } as CuentaContable
}

/** Sesión de un contador: rol base NO exento + las claves RBAC indicadas. */
function montar(permisos: string[]) {
  const session = {
    user_id: 'u1', company_id: 'c1', role: 'operator',
    permissions: new Set(permisos),
  } as unknown as UserSession
  return render(
    <SessionProvider value={session}>
      <PermissionsProvider>
        <CatalogoCuentasTab companyId="c1" projectId={null} monedaBase="GTQ" proyectos={[]} />
      </PermissionsProvider>
    </SessionProvider>,
  )
}

const TODAS = [
  'platform.contabilidad.view', 'platform.contabilidad.create',
  'platform.contabilidad.edit', 'platform.contabilidad.change_status',
]

beforeEach(() => { state.cuentas = [cuenta()] })
afterEach(cleanup)

describe('CatalogoCuentasTab — gating por permiso', () => {
  it('con create/edit/change_status muestra las acciones de escritura', () => {
    montar(TODAS)
    expect(screen.getByText('+ Nueva cuenta')).toBeTruthy()
    expect(screen.getByText('📥 Carga masiva')).toBeTruthy()
    expect(screen.getByText('Editar')).toBeTruthy()
    expect(screen.getByText('Desactivar')).toBeTruthy()
  })

  it('solo con view no muestra ninguna acción de escritura', () => {
    montar(['platform.contabilidad.view'])
    expect(screen.queryByText('+ Nueva cuenta')).toBeNull()
    expect(screen.queryByText('📥 Carga masiva')).toBeNull()
    expect(screen.queryByText('Editar')).toBeNull()
    expect(screen.queryByText('Desactivar')).toBeNull()
    // …pero el catálogo sí se lee: el permiso de ver sigue sirviendo.
    expect(screen.getByText(/1102-01/)).toBeTruthy()
  })

  it('cada acción se gatea por su propia clave', () => {
    montar(['platform.contabilidad.view', 'platform.contabilidad.edit'])
    expect(screen.getByText('Editar')).toBeTruthy()
    expect(screen.queryByText('+ Nueva cuenta')).toBeNull()
    expect(screen.queryByText('Desactivar')).toBeNull()
  })
})
