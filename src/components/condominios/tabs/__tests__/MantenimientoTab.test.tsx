// Eliminar un ticket exige condominios.tab.mantenimiento.delete (canDelete).
//
// El 🗑 de cada tarjeta se mostraba y borraba sin mirar ningún permiso, así
// que un rol de solo consulta podía eliminar tickets. Lo que se vigila aquí:
//
//   1. Sin permiso de eliminar no hay 🗑, tampoco para quien sí puede editar.
//   2. Con el permiso, el botón borra (soft delete) aunque no se pueda editar.
//   3. Si la base no lo marca —la RLS lo rechaza con 42501 porque falta
//      `.delete` (20261104000100), o 0 filas porque ya no estaba—, la pestaña
//      lo dice y no refresca como si se hubiera borrado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { TicketMantenimiento } from '../../../../types'

const mocks = vi.hoisted(() => ({
  softDelete: vi.fn(async () => ({
    error: null as { message: string; code?: string } | null,
    count: 1 as number | null,
  })),
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
}))
vi.mock('../../../../lib/softDelete', () => ({ softDelete: mocks.softDelete }))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify, confirm: mocks.confirm }))
vi.mock('../exportUtils', () => ({ exportarPDFTabla: vi.fn(), exportarExcel: vi.fn() }))

const { MantenimientoTab } = await import('../MantenimientoTab')

function ticket(over: Partial<TicketMantenimiento> = {}): TicketMantenimiento {
  return {
    id: 't1', company_id: 'co1', project_id: 'p1',
    tipo: 'correctivo', titulo: 'Fuga en lobby', prioridad: 'media', estado: 'abierto',
    foto_urls: [], archivo_urls: [],
    created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
    ...over,
  }
}

function renderTab(props: Partial<Parameters<typeof MantenimientoTab>[0]> = {}) {
  return render(
    <MantenimientoTab
      tickets={[ticket()]}
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

describe('MantenimientoTab — Eliminar exige el permiso de eliminar del tab', () => {
  it.each([
    ['solo consulta', { canCreate: false, canEdit: false, canDelete: false }],
    ['editar sin eliminar', { canDelete: false }],
  ])('%s: la tarjeta no ofrece Eliminar', (_caso, permisos) => {
    renderTab(permisos)
    expect(screen.getByText('Fuga en lobby')).toBeTruthy()
    expect(screen.queryByTitle('Eliminar')).toBeNull()
  })

  it('con permiso de eliminar (aunque no edite) el botón borra el ticket', async () => {
    renderTab({ canEdit: false })
    fireEvent.click(screen.getByTitle('Eliminar'))

    await waitFor(() => expect(mocks.softDelete).toHaveBeenCalledWith('tickets_mantenimiento', { id: 't1' }))
    await waitFor(() => expect(mocks.onRefresh).toHaveBeenCalled())
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('si la RLS rechaza el borrado (42501), lo dice en español y no refresca', async () => {
    mocks.softDelete.mockResolvedValueOnce({
      error: { code: '42501', message: 'new row violates row-level security policy for table "tickets_mantenimiento"' },
      count: null,
    })
    renderTab()
    fireEvent.click(screen.getByTitle('Eliminar'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'error',
      title: 'No se eliminó el ticket',
      text: 'Tu usuario no tiene permiso para eliminar tickets de mantenimiento.',
    })))
    expect(mocks.onRefresh).not.toHaveBeenCalled()
  })

  it('si no marcó ninguna fila (ya no estaba), avisa y no refresca', async () => {
    mocks.softDelete.mockResolvedValueOnce({ error: null, count: 0 })
    renderTab()
    fireEvent.click(screen.getByTitle('Eliminar'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'error',
      title: 'No se eliminó el ticket',
      text: expect.stringMatching(/^El servidor no aplicó el cambio/),
    })))
    expect(mocks.onRefresh).not.toHaveBeenCalled()
  })

  it('otro error del servidor se muestra tal cual', async () => {
    mocks.softDelete.mockResolvedValueOnce({ error: { code: '08006', message: 'connection failure' }, count: null })
    renderTab()
    fireEvent.click(screen.getByTitle('Eliminar'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'error', text: 'connection failure',
    })))
    expect(mocks.onRefresh).not.toHaveBeenCalled()
  })
})
