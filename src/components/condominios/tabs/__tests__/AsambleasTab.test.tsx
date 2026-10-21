// Eliminar una asamblea exige condominios.tab.asambleas.delete (canDelete).
//
// El 🗑 de cada fila se mostraba y borraba sin mirar ningún permiso, así que
// un rol de solo consulta podía eliminar asambleas. Lo que se vigila aquí:
//
//   1. Sin permiso de eliminar no hay 🗑, tampoco para quien sí puede editar.
//   2. Con el permiso, el botón borra aunque no se pueda editar.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { Asamblea } from '../../../../types'

const mocks = vi.hoisted(() => ({
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
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
  deleteCondominioRow: mocks.deleteCondominioRow,
  upsertCondominioRow: vi.fn(async () => ({ error: null })),
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({
  fetchPuntosAsambleaConVotos: vi.fn(async () => []),
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm }))

const { AsambleasTab } = await import('../AsambleasTab')

function asamblea(over: Partial<Asamblea> = {}): Asamblea {
  return {
    id: 'a1', company_id: 'co1', project_id: 'p1',
    titulo: 'Asamblea ordinaria 2026', tipo: 'ordinaria',
    fecha: '2026-09-01', hora_inicio: '18:00', estado: 'programada',
    quorum_requerido: 51, created_at: '2026-09-01T00:00:00.000Z',
    ...over,
  }
}

function renderTab(props: Partial<Parameters<typeof AsambleasTab>[0]> = {}) {
  return render(
    <AsambleasTab
      asambleas={[asamblea()]}
      unidades={[]}
      proyectoId="p1"
      companyId="co1"
      userId="user1"
      canCreate
      canEdit
      canDelete
      onRefresh={mocks.onRefresh}
      {...props}
    />,
  )
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(() => { cleanup() })

describe('AsambleasTab — Eliminar exige el permiso de eliminar del tab', () => {
  it.each([
    ['solo consulta', { canCreate: false, canEdit: false, canDelete: false }],
    ['editar sin eliminar', { canDelete: false }],
  ])('%s: la fila no ofrece Eliminar', (_caso, permisos) => {
    renderTab(permisos)
    expect(screen.getByText('Asamblea ordinaria 2026')).toBeTruthy()
    expect(screen.queryByTitle('Eliminar')).toBeNull()
  })

  it('con permiso de eliminar (aunque no edite) el botón borra la asamblea', async () => {
    renderTab({ canEdit: false })
    fireEvent.click(screen.getByTitle('Eliminar'))

    await waitFor(() => expect(mocks.deleteCondominioRow).toHaveBeenCalledWith('asambleas', 'a1'))
  })
})
