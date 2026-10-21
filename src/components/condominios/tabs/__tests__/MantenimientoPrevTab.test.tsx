import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { EjecucionMantenimiento, PlanMantenimiento } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  fetchEjecucionesMantenimiento: vi.fn(async (): Promise<unknown[]> => []),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({
  fetchEjecucionesMantenimiento: mocks.fetchEjecucionesMantenimiento,
}))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify }))

const { MantenimientoPrevTab } = await import('../MantenimientoPrevTab')

const plan = {
  id: 'pl1', company_id: 'co1', project_id: 'p1', equipo: 'Bomba de agua', descripcion: null,
  frecuencia: 'mensual', responsable: 'Hidrotec', ultima_ejecucion: '2026-09-01', proxima_ejecucion: '2026-10-01',
  costo_estimado: 150, activo: true, created_at: '2026-01-01T00:00:00Z',
} as unknown as PlanMantenimiento

const ejecucion = {
  id: 'e1', company_id: 'co1', plan_id: 'pl1', fecha: '2026-09-01', realizado_por: 'Hidrotec',
  costo_real: 140, observaciones: 'Cambio de sello', estado: 'completado', created_at: '2026-09-01T00:00:00Z',
} as unknown as EjecucionMantenimiento

function renderTab(props: Partial<Parameters<typeof MantenimientoPrevTab>[0]> = {}) {
  return render(
    <MantenimientoPrevTab planes={[plan]} proyectoId="p1" companyId="co1" moneda="USD"
      canCreate canEdit onRefresh={() => {}} {...props} />,
  )
}

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockClear())
  mocks.fetchEjecucionesMantenimiento.mockResolvedValue([ejecucion])
})
afterEach(cleanup)

describe('MantenimientoPrevTab — ventanas', () => {
  it('cada plan se abre en ventana (pantalla completa en el teléfono) con su historial', async () => {
    renderTab()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Bomba de agua/ }))

    const dialog = screen.getByRole('dialog', { name: 'Bomba de agua' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText(/Est\. USD 150\.00/)).toBeTruthy()
    expect(await within(dialog).findByText('Cambio de sello')).toBeTruthy()
    expect(mocks.fetchEjecucionesMantenimiento).toHaveBeenCalledWith('pl1')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('el formulario de nuevo plan es una ventana y guarda el plan', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo Plan' }))
    const dialog = screen.getByRole('dialog', { name: 'Nuevo plan de mantenimiento' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Equipo / Área *'), { target: { value: 'Ascensor' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('planes_mantenimiento', expect.objectContaining({ equipo: 'Ascensor', activo: true })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('registrar una ejecución desde la ventana guarda la ejecución y reprograma el plan', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /Bomba de agua/ }))
    const dialog = screen.getByRole('dialog', { name: 'Bomba de agua' })
    fireEvent.click(within(dialog).getByRole('button', { name: '+ Registrar ejecución' }))
    fireEvent.change(within(dialog).getByLabelText('Fecha *'), { target: { value: '2026-10-15' } })
    fireEvent.change(within(dialog).getByLabelText('Observaciones'), { target: { value: 'Sin novedad' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('ejecuciones_mantenimiento', expect.objectContaining({
      plan_id: 'pl1', fecha: '2026-10-15', observaciones: 'Sin novedad',
    })))
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('planes_mantenimiento', 'pl1', { ultima_ejecucion: '2026-10-15', proxima_ejecucion: '2026-11-14' })
  })

  it('sin permisos la ventana es de solo lectura', async () => {
    renderTab({ canCreate: false, canEdit: false })
    expect(screen.queryByRole('button', { name: '+ Nuevo Plan' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Bomba de agua/ }))
    const dialog = screen.getByRole('dialog', { name: 'Bomba de agua' })
    expect(await within(dialog).findByText('Cambio de sello')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: '+ Registrar ejecución' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Desactivar' })).toBeNull()
  })
})
