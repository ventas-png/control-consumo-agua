import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { MemoriaLabores } from '../../../../types'

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

const { MemoriaTab } = await import('../MemoriaTab')

function memoria(over: Partial<MemoriaLabores> = {}): MemoriaLabores {
  return {
    id: 'm1', company_id: 'co1', project_id: 'p1', titulo: 'Informe Mensual Septiembre 2026', periodo: '2026-09',
    tipo_periodo: 'mensual', resumen: 'Mes con obras de impermeabilización.', logros: '• Techo de la casa club sellado\n• Bomba 2 reparada',
    pendientes: '• Pintar portón', tickets_resueltos: 14, visitantes_registrados: 230, cuotas_cobradas: null, incidencias_atendidas: 3,
    estado: 'borrador', created_at: '2026-10-01T10:00:00Z',
    ...over,
  } as unknown as MemoriaLabores
}

function renderTab(props: Partial<Parameters<typeof MemoriaTab>[0]> = {}) {
  return render(
    <MemoriaTab memorias={[memoria(), memoria({ id: 'm2', titulo: 'Informe Anual 2025', periodo: '2025', tipo_periodo: 'anual', estado: 'publicado' })]}
      proyectoId="p1" companyId="co1" userId="u1" canCreate canEdit onRefresh={() => {}} {...props} />,
  )
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('MemoriaTab — ventanas', () => {
  it('cada memoria se abre en ventana (pantalla completa en el teléfono) con métricas y textos', () => {
    renderTab()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Informe Mensual Septiembre 2026/ }))

    const dialog = screen.getByRole('dialog', { name: 'Informe Mensual Septiembre 2026' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText('2026-09 · Mensual')).toBeTruthy()
    expect(within(dialog).getByText('230')).toBeTruthy()
    // Solo las métricas registradas: cuotas viene vacía.
    expect(within(dialog).queryByText('💳 Cuotas')).toBeNull()
    expect(within(dialog).getByText('Mes con obras de impermeabilización.')).toBeTruthy()
    expect(within(dialog).getByText(/Bomba 2 reparada/)).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('la ventana se cierra sola si la memoria desaparece tras refrescar', () => {
    const { rerender } = renderTab()
    fireEvent.click(screen.getByRole('button', { name: /^Informe Anual 2025/ }))
    expect(screen.getByRole('dialog', { name: 'Informe Anual 2025' })).toBeTruthy()
    rerender(<MemoriaTab memorias={[memoria()]} proyectoId="p1" companyId="co1" userId="u1" canCreate canEdit onRefresh={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('el formulario de nueva memoria es una ventana y crea el registro', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva Memoria' }))
    const dialog = screen.getByRole('dialog', { name: 'Nueva Memoria de Labores' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Título *'), { target: { value: 'Informe Mensual Octubre 2026' } })
    fireEvent.change(within(dialog).getByLabelText('Período *'), { target: { value: '2026-10' } })
    fireEvent.change(within(dialog).getByLabelText('🔧 Tickets resueltos'), { target: { value: '9' } })
    fireEvent.change(within(dialog).getByLabelText('Resumen ejecutivo'), { target: { value: 'Mes tranquilo.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('memoria_labores', expect.objectContaining({
      titulo: 'Informe Mensual Octubre 2026', periodo: '2026-10', tickets_resueltos: 9, resumen: 'Mes tranquilo.', estado: 'borrador',
    })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('editar abre la ventana con los datos y actualiza', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Editar Informe Mensual Septiembre 2026' }))
    const dialog = screen.getByRole('dialog', { name: 'Editar Memoria' })
    expect((within(dialog).getByLabelText('Período *') as HTMLInputElement).value).toBe('2026-09')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Actualizar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('memoria_labores', 'm1', expect.objectContaining({ periodo: '2026-09' })))
  })

  it('publicar un borrador desde la lista', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('memoria_labores', 'm1', { estado: 'publicado', publicado_por: 'u1' }))
  })

  it('sin permisos no hay acciones, pero la memoria se puede leer', () => {
    renderTab({ canCreate: false, canEdit: false })
    expect(screen.queryByRole('button', { name: '+ Nueva Memoria' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Eliminar/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Informe Mensual Septiembre 2026/ }))
    expect(screen.getByRole('dialog', { name: 'Informe Mensual Septiembre 2026' })).toBeTruthy()
  })
})
