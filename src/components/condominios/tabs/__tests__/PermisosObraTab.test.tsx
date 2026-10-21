import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { PermisoObraUnidad, Unidad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

const { PermisosObraTab } = await import('../PermisosObraTab')

const unidades = [{ id: 'un1', nombre: 'Casa 4', activo: true }] as unknown as Unidad[]

function permiso(over: Partial<PermisoObraUnidad> = {}): PermisoObraUnidad {
  return {
    id: 'po1', company_id: 'co1', project_id: 'p1', unidad_id: 'un1', tipo_obra: 'remodelacion',
    descripcion: 'Remodelar cocina', fecha_inicio: '2026-11-01', fecha_fin_estimada: '2026-11-30',
    horario_permitido: 'Lun-Vie 8:00-17:00', fianza: 500, estado: 'solicitado',
    aprobado_por: null, observaciones: 'Sin ruido después de las 5', created_at: '2026-10-20T00:00:00Z',
    ...over,
  } as PermisoObraUnidad
}

type Props = Parameters<typeof PermisosObraTab>[0]
function props(over: Partial<Props> = {}): Props {
  return {
    permisos: [permiso()], unidades, proyectoId: 'p1', companyId: 'co1', moneda: 'USD',
    canCreate: true, canEdit: true, onRefresh: () => {}, ...over,
  }
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('PermisosObraTab — ventanas', () => {
  it('cada permiso se abre en ventana (pantalla completa en el teléfono)', () => {
    render(<PermisosObraTab {...props()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Remodelar cocina/ }))

    const dialog = screen.getByRole('dialog', { name: '🔨 Remodelar cocina' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText('Lun-Vie 8:00-17:00')).toBeTruthy()
    expect(within(dialog).getByText('USD 500.00')).toBeTruthy()
    expect(within(dialog).getByText('Unidad: Casa 4')).toBeTruthy()
    expect(within(dialog).getByText('Sin ruido después de las 5')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('aprobar desde la ventana avanza el estado y la ventana lo refleja', async () => {
    const onRefresh = vi.fn()
    render(<PermisosObraTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: /Remodelar cocina/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '→ Aprobar' }))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('permisos_obra_unidad', 'po1', { estado: 'aprobado' }))
    expect(onRefresh).toHaveBeenCalled()
    expect(await within(dialog).findByRole('button', { name: '→ Iniciar Ejecución' })).toBeTruthy()
  })

  it('rechazar pide confirmación y marca rechazado; la ventana muestra la fila vigente', async () => {
    const { rerender } = render(<PermisosObraTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: /Remodelar cocina/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '✗ Rechazar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('permisos_obra_unidad', 'po1', { estado: 'rechazado' }))
    expect(mocks.confirm).toHaveBeenCalled()

    // Lo que trae onRefresh llega a la ventana abierta.
    rerender(<PermisosObraTab {...props({ permisos: [permiso({ estado: 'rechazado' })] })} />)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: '✗ Rechazar' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /^→/ })).toBeNull()
  })

  it('el formulario de nuevo permiso es una ventana y guarda', async () => {
    render(<PermisosObraTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo permiso' }))
    const dialog = screen.getByRole('dialog', { name: 'Nuevo permiso de obra' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Descripción *'), { target: { value: 'Pintar fachada' } })
    fireEvent.change(within(dialog).getByLabelText('Tipo de obra *'), { target: { value: 'pintura' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('permisos_obra_unidad', expect.objectContaining({ descripcion: 'Pintar fachada', tipo_obra: 'pintura' })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('sin permiso de edición no hay editar ni cambios de estado', () => {
    render(<PermisosObraTab {...props({ canCreate: false, canEdit: false })} />)
    expect(screen.queryByRole('button', { name: '+ Nuevo permiso' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Remodelar cocina/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: '✏️ Editar' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: '→ Aprobar' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: '✗ Rechazar' })).toBeNull()
  })
})
