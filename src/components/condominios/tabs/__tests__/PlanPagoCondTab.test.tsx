import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { PlanPagoCond, CuotaPlanPago, Unidad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null })),
  createCondominioRowReturning: vi.fn(async (..._args: unknown[]) => ({ data: { id: 'pl-nuevo' } as Record<string, unknown> | null, error: null })),
  updateCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null })),
  deleteCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null })),
  fetchCuotasPlanPago: vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  createCondominioRowReturning: mocks.createCondominioRowReturning,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({ fetchCuotasPlanPago: mocks.fetchCuotasPlanPago }))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

const { PlanPagoCondTab } = await import('../PlanPagoCondTab')

const unidades = [{ id: 'un1', nombre: 'Casa 4', activo: true }] as unknown as Unidad[]

function plan(over: Partial<PlanPagoCond> = {}): PlanPagoCond {
  return {
    id: 'pl1', company_id: 'co1', project_id: 'p1', unidad_id: 'un1',
    concepto: 'Deuda cuotas Q1 2026', monto_total: 1000, num_cuotas: 2, monto_cuota: 500,
    fecha_inicio: '2026-09-01', estado: 'activo', notas: null, aprobado_por: 'Junta Directiva',
    created_at: '2026-08-25T10:00:00Z',
    ...over,
  } as unknown as PlanPagoCond
}

const cuotas = [
  { id: 'q1', company_id: 'co1', plan_id: 'pl1', numero: 1, monto: 500, fecha_vencimiento: '2026-10-01', pagado: true, fecha_pago: '2026-09-28', created_at: '2026-08-25T10:00:00Z' },
  { id: 'q2', company_id: 'co1', plan_id: 'pl1', numero: 2, monto: 500, fecha_vencimiento: '2099-11-01', pagado: false, fecha_pago: null, created_at: '2026-08-25T10:00:00Z' },
] as unknown as CuotaPlanPago[]

function props(over: Partial<Parameters<typeof PlanPagoCondTab>[0]> = {}): Parameters<typeof PlanPagoCondTab>[0] {
  return {
    planes: [plan()], unidades, proyectoId: 'p1', companyId: 'co1', moneda: 'USD',
    canCreate: true, canEdit: true, onRefresh: () => {}, ...over,
  }
}

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockClear())
  mocks.fetchCuotasPlanPago.mockImplementation(async () => cuotas)
})
afterEach(cleanup)

describe('PlanPagoCondTab — ventanas', () => {
  it('las cuotas de un plan se abren en ventana (pantalla completa en el teléfono)', async () => {
    render(<PlanPagoCondTab {...props()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Deuda cuotas Q1 2026/ }))

    const dialog = screen.getByRole('dialog', { name: 'Deuda cuotas Q1 2026' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(mocks.fetchCuotasPlanPago).toHaveBeenCalledWith('pl1')
    expect(await within(dialog).findByText('Cuota #2')).toBeTruthy()
    expect(within(dialog).getByText('1/2 pagadas')).toBeTruthy()
    expect(within(dialog).getByText('Pagado: 2026-09-28')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('pagar la última cuota completa el plan y la ventana muestra el estado refrescado', async () => {
    const onRefresh = vi.fn()
    const { rerender } = render(<PlanPagoCondTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: /^Deuda cuotas Q1 2026/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Activo')).toBeTruthy()

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Marcar pagado' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('planes_pago_condominio', 'pl1', { estado: 'completado' }))
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('cuotas_plan_pago', 'q2', expect.objectContaining({ pagado: true }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())

    // Antes la ventana guardaba una copia del plan y seguía diciendo "Activo".
    rerender(<PlanPagoCondTab {...props({ onRefresh, planes: [plan({ estado: 'completado' })] })} />)
    expect(within(screen.getByRole('dialog')).getByText('Completado')).toBeTruthy()
  })

  it('el formulario de nuevo plan es una ventana y genera las cuotas', async () => {
    const onRefresh = vi.fn()
    render(<PlanPagoCondTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo Plan' }))
    const dialog = screen.getByRole('dialog', { name: 'Nuevo plan de pago' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Unidad *'), { target: { value: 'un1' } })
    fireEvent.change(within(dialog).getByLabelText('Concepto *'), { target: { value: 'Mora 2025' } })
    fireEvent.change(within(dialog).getByLabelText(/Monto total/), { target: { value: '900' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear plan' }))

    await waitFor(() => expect(mocks.createCondominioRowReturning).toHaveBeenCalledWith('planes_pago_condominio', expect.objectContaining({
      unidad_id: 'un1', concepto: 'Mora 2025', monto_total: 900, num_cuotas: 3, monto_cuota: 300,
    })))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('cuotas_plan_pago', expect.any(Array)))
    const cuotasCreadas = mocks.createCondominioRow.mock.calls[0][1] as unknown[]
    expect(cuotasCreadas).toHaveLength(3)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('sin permiso de edición la ventana es de solo lectura', async () => {
    render(<PlanPagoCondTab {...props({ canCreate: false, canEdit: false })} />)
    expect(screen.queryByRole('button', { name: '+ Nuevo Plan' })).toBeNull()
    // El único "Incumplido" es el chip de filtro, no la acción de la fila.
    expect(screen.getAllByRole('button', { name: 'Incumplido' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /^Eliminar plan/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Deuda cuotas Q1 2026/ }))
    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByText('Cuota #2')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Marcar pagado' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Eliminar plan' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Marcar incumplido' })).toBeNull()
  })
})
