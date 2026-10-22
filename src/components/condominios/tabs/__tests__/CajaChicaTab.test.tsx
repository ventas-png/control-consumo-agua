import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { CajaChica, MovimientoCaja } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null })),
  updateCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null })),
  deleteCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null })),
  openPromptDialog: vi.fn(async (..._args: unknown[]): Promise<Record<string, string> | null> => ({ cerrado_por: 'Luis Gómez' })),
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
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: mocks.openPromptDialog }))

const { CajaChicaTab } = await import('../CajaChicaTab')

function caja(over: Partial<CajaChica> = {}): CajaChica {
  return {
    id: 'cj1', company_id: 'co1', project_id: 'p1', fecha_apertura: '2026-10-01', monto_inicial: 1000,
    responsable: 'Ana Pérez', estado: 'abierta', fecha_cierre: null, cerrado_por: null, notas: null,
    created_at: '2026-10-01T08:00:00Z',
    ...over,
  } as unknown as CajaChica
}

const movimientos = [
  { id: 'm1', company_id: 'co1', caja_id: 'cj1', tipo: 'egreso', concepto: 'Papelería', monto: 150, comprobante: 'F-12', fecha: '2026-10-05', created_at: '2026-10-05T09:00:00Z' },
  { id: 'm2', company_id: 'co1', caja_id: 'cj1', tipo: 'ingreso', concepto: 'Reposición de fondo', monto: 200, comprobante: null, fecha: '2026-10-06', created_at: '2026-10-06T09:00:00Z' },
] as unknown as MovimientoCaja[]

const fmt = (n: number) => `USD ${n.toLocaleString('es', { minimumFractionDigits: 2 })}`

function props(over: Partial<Parameters<typeof CajaChicaTab>[0]> = {}): Parameters<typeof CajaChicaTab>[0] {
  return {
    cajas: [caja(), caja({ id: 'cj2', responsable: 'Luis Gómez', estado: 'cerrada', monto_inicial: 500 })],
    movimientos, proyectoId: 'p1', companyId: 'co1', moneda: 'USD',
    canCreate: true, canEdit: true, canDelete: true, onRefresh: () => {}, ...over,
  }
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('CajaChicaTab — ventanas', () => {
  it('los movimientos de una caja se abren en ventana (pantalla completa en el teléfono)', () => {
    render(<CajaChicaTab {...props()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Ana Pérez/ }))

    const dialog = screen.getByRole('dialog', { name: 'Caja chica — Ana Pérez' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText('Papelería')).toBeTruthy()
    expect(within(dialog).getByText('Movimientos (2)')).toBeTruthy()
    expect(within(dialog).getByText(`Saldo actual: ${fmt(1050)}`)).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('registrar un movimiento desde la ventana lo guarda en esa caja', async () => {
    const onRefresh = vi.fn()
    render(<CajaChicaTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: /^Ana Pérez/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '+ Movimiento' }))
    fireEvent.change(within(dialog).getByLabelText('Concepto *'), { target: { value: 'Café' } })
    fireEvent.change(within(dialog).getByLabelText('Monto *'), { target: { value: '25' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('movimientos_caja', expect.objectContaining({
      caja_id: 'cj1', tipo: 'egreso', concepto: 'Café', monto: 25,
    })))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(within(dialog).queryByLabelText('Concepto *')).toBeNull()
  })

  it('cerrar la caja desde la ventana y, tras refrescar, la ventana la muestra cerrada', async () => {
    const onRefresh = vi.fn()
    const { rerender } = render(<CajaChicaTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: /^Ana Pérez/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cerrar caja' }))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('caja_chica', 'cj1', expect.objectContaining({
      estado: 'cerrada', cerrado_por: 'Luis Gómez',
    })))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())

    rerender(<CajaChicaTab {...props({ onRefresh, cajas: [caja({ estado: 'cerrada' })] })} />)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Cerrada')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: '+ Movimiento' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Cerrar caja' })).toBeNull()
  })

  it('abrir caja es una ventana con sus etiquetas', async () => {
    render(<CajaChicaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Abrir Caja' }))
    const dialog = screen.getByRole('dialog', { name: 'Abrir nueva caja' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Responsable *'), { target: { value: 'Marta Díaz' } })
    fireEvent.change(within(dialog).getByLabelText(/Monto inicial/), { target: { value: '300' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Abrir caja' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('caja_chica', expect.objectContaining({
      responsable: 'Marta Díaz', monto_inicial: 300, company_id: 'co1', project_id: 'p1',
    })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('sin permisos no se abre, cierra ni mueve caja, pero se puede consultar', () => {
    render(<CajaChicaTab {...props({ canCreate: false, canEdit: false, canDelete: false })} />)
    expect(screen.queryByRole('button', { name: '+ Abrir Caja' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cerrar' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Ana Pérez/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Papelería')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: '+ Movimiento' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Cerrar caja' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /Eliminar movimiento/ })).toBeNull()
  })
})
