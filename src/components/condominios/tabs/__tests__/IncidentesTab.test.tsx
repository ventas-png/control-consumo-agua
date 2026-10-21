// Eliminar un incidente exige condominios.tab.incidentes.delete (canDelete).
//
// "🗑 Eliminar" del detalle se mostraba y borraba sin mirar ningún permiso,
// así que un rol de solo consulta podía eliminar incidentes. Lo que se vigila:
//
//   1. Sin permiso de eliminar no hay botón, tampoco para quien sí puede editar.
//   2. Con el permiso, el botón borra aunque no se pueda editar.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { IncidenteSeguridad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  deleteCondominioRowAfectando: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  onRefresh: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: () => ({}) },
  db: { from: () => ({}) },
}))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRowAfectando: mocks.deleteCondominioRowAfectando,
}))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify, confirm: mocks.confirm }))
vi.mock('../exportUtils', () => ({ exportarPDFTabla: vi.fn(), exportarExcel: vi.fn() }))

const { IncidentesTab } = await import('../IncidentesTab')

function incidente(over: Partial<IncidenteSeguridad> = {}): IncidenteSeguridad {
  return {
    id: 'i1', company_id: 'co1', project_id: 'p1',
    fecha: '2026-09-01', tipo: 'robo', descripcion: 'Bicicleta robada en parqueo',
    estado: 'reportado', created_at: '2026-09-01T00:00:00.000Z',
    ...over,
  }
}

function renderTab(props: Partial<Parameters<typeof IncidentesTab>[0]> = {}) {
  return render(
    <IncidentesTab
      incidentes={[incidente()]}
      proyectoId="p1"
      companyId="co1"
      canCreate
      canEdit
      canDelete
      onRefresh={mocks.onRefresh}
      {...props}
    />,
  )
}

function abrirDetalle() {
  fireEvent.click(screen.getByText('Bicicleta robada en parqueo'))
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(() => { cleanup() })

describe('IncidentesTab — Eliminar exige el permiso de eliminar del tab', () => {
  it.each([
    ['solo consulta', { canCreate: false, canEdit: false, canDelete: false }],
    ['editar sin eliminar', { canDelete: false }],
  ])('%s: el detalle no ofrece Eliminar', (_caso, permisos) => {
    renderTab(permisos)
    abrirDetalle()
    expect(screen.queryByText('🗑 Eliminar')).toBeNull()
  })

  it('con permiso de eliminar (aunque no edite) el botón borra el incidente', async () => {
    renderTab({ canEdit: false })
    abrirDetalle()
    fireEvent.click(screen.getByText('🗑 Eliminar'))

    await waitFor(() => expect(mocks.deleteCondominioRowAfectando).toHaveBeenCalledWith('incidentes_seguridad', 'i1'))
  })

  it('si la base no borra (la RLS lo rechaza), avisa y no da el incidente por eliminado', async () => {
    mocks.deleteCondominioRowAfectando.mockResolvedValueOnce({ error: { message: 'El servidor no aplicó el cambio', code: 'SIN_FILAS' } })
    renderTab()
    abrirDetalle()
    fireEvent.click(screen.getByText('🗑 Eliminar'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' })))
    expect(mocks.onRefresh).not.toHaveBeenCalled()
    expect(screen.getByText('🗑 Eliminar')).toBeTruthy()
  })
})
