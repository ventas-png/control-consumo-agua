import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { ObraMejora } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null })),
  updateCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null })),
  deleteCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null })),
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

const { ObrasTab } = await import('../ObrasTab')

function obra(over: Partial<ObraMejora> = {}): ObraMejora {
  return {
    id: 'o1', company_id: 'co1', project_id: 'p1', titulo: 'Remodelación salón comunal', descripcion: null,
    area: 'Salón', contratista: 'Constructora Sol', monto_contrato: 25000,
    fecha_inicio: '2026-09-01', fecha_fin_estimada: '2026-12-15', fecha_fin_real: null,
    estado: 'en_ejecucion', progreso: 40, notas: 'Incluye pintura y piso.', created_at: '2026-08-20T10:00:00Z',
    ...over,
  } as unknown as ObraMejora
}

function props(over: Partial<Parameters<typeof ObrasTab>[0]> = {}): Parameters<typeof ObrasTab>[0] {
  return {
    obras: [obra(), obra({ id: 'o2', titulo: 'Bomba de piscina', estado: 'completada', progreso: 100, notas: null })],
    proyectoId: 'p1', companyId: 'co1', moneda: 'USD', canCreate: true, canEdit: true, canDelete: true, onRefresh: () => {}, ...over,
  }
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('ObrasTab — ventanas', () => {
  it('el detalle de la obra se abre en ventana (pantalla completa en el teléfono)', () => {
    render(<ObrasTab {...props()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Remodelación salón comunal/ }))

    const dialog = screen.getByRole('dialog', { name: 'Remodelación salón comunal' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText('Constructora Sol')).toBeTruthy()
    expect(within(dialog).getByText('2026-12-15')).toBeTruthy()
    expect(within(dialog).getByText('Incluye pintura y piso.')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('llevar el progreso a 100% completa la obra y la ventana muestra el dato refrescado', async () => {
    const onRefresh = vi.fn()
    const { rerender } = render(<ObrasTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: /^Remodelación salón comunal/ }))
    const rango = within(screen.getByRole('dialog')).getByLabelText(/Actualizar progreso/)
    fireEvent.change(rango, { target: { value: '100' } })
    fireEvent.mouseUp(rango)

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('obras_mejoras', 'o1', { progreso: 100, estado: 'completada' }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())

    // Antes la ventana guardaba una copia y seguía "En ejecución" al 40%.
    rerender(<ObrasTab {...props({ onRefresh, obras: [obra({ progreso: 100, estado: 'completada' })] })} />)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('100% de avance')).toBeTruthy()
    expect(within(dialog).queryByLabelText(/Actualizar progreso/)).toBeNull()
  })

  it('editar desde la ventana abre el formulario, también en ventana', async () => {
    render(<ObrasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: /^Remodelación salón comunal/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '✏️ Editar' }))

    const dialog = screen.getByRole('dialog', { name: 'Editar obra' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect((within(dialog).getByLabelText('Título *') as HTMLInputElement).value).toBe('Remodelación salón comunal')
    fireEvent.change(within(dialog).getByLabelText('Contratista'), { target: { value: 'Obras del Norte' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('obras_mejoras', 'o1', expect.objectContaining({
      titulo: 'Remodelación salón comunal', contratista: 'Obras del Norte',
    })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('el formulario de nueva obra es una ventana y crea la obra', async () => {
    render(<ObrasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva Obra' }))
    const dialog = screen.getByRole('dialog', { name: 'Nueva obra' })
    fireEvent.change(within(dialog).getByLabelText('Título *'), { target: { value: 'Cambio de luminarias' } })
    fireEvent.change(within(dialog).getByLabelText(/Monto contrato/), { target: { value: '1800' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('obras_mejoras', expect.objectContaining({
      titulo: 'Cambio de luminarias', monto_contrato: 1800, estado: 'planificada', company_id: 'co1', project_id: 'p1',
    })))
  })

  it('sin permiso de edición la ventana es de solo lectura', () => {
    render(<ObrasTab {...props({ canCreate: false, canEdit: false, canDelete: false })} />)
    expect(screen.queryByRole('button', { name: '+ Nueva Obra' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Editar / })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Remodelación salón comunal/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Constructora Sol')).toBeTruthy()
    expect(within(dialog).queryByLabelText(/Actualizar progreso/)).toBeNull()
    expect(within(dialog).queryByRole('button', { name: '✏️ Editar' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Eliminar obra' })).toBeNull()
  })
})
