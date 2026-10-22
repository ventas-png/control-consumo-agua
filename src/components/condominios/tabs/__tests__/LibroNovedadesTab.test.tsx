import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { LibroNovedad } from '../../../../types'

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

const { LibroNovedadesTab } = await import('../LibroNovedadesTab')

const entrada = {
  id: 'n1', company_id: 'co1', project_id: 'p1', fecha: '2026-10-20', turno: 'noche',
  responsable: 'Carlos Pérez', hora_inicio: '22:00', hora_fin: '06:00',
  novedades: 'Ronda sin novedad.\nPortón norte revisado.',
  incidentes: [{ hora: '02:15', tipo: 'visita', descripcion: 'Ingreso de ambulancia a Casa 7' }],
  firmado: false, created_at: '2026-10-21T06:00:00Z',
} as unknown as LibroNovedad

function renderTab(props: Partial<Parameters<typeof LibroNovedadesTab>[0]> = {}) {
  return render(
    <LibroNovedadesTab novedades={[entrada]} proyectoId="p1" companyId="co1"
      canCreate canEdit canDelete onRefresh={() => {}} {...props} />,
  )
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('LibroNovedadesTab — ventanas', () => {
  it('cada entrada se abre en ventana (pantalla completa en el teléfono) y Escape la cierra', () => {
    renderTab()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /2026-10-20.*Carlos Pérez/ }))

    const dialog = screen.getByRole('dialog', { name: '🌙 2026-10-20 — noche' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText(/Portón norte revisado/)).toBeTruthy()
    expect(within(dialog).getByText('Ingreso de ambulancia a Casa 7')).toBeTruthy()
    expect(within(dialog).getByText(/Carlos Pérez · 22:00 – 06:00/)).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('las acciones de la fila siguen al lado y no abren la ventana', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: 'Firmar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('libro_novedades', 'n1', { firmado: true }))
    expect(onRefresh).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('el formulario de nueva entrada es una ventana y guardar crea la fila', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva entrada' }))
    const dialog = screen.getByRole('dialog', { name: 'Nueva entrada' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Responsable *'), { target: { value: 'Ana Ruiz' } })
    fireEvent.change(within(dialog).getByLabelText('Novedades del turno *'), { target: { value: 'Turno tranquilo.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '+ Agregar' }))
    fireEvent.change(within(dialog).getByLabelText('Descripción del incidente 1'), { target: { value: 'Luz fundida en lobby' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('libro_novedades', expect.objectContaining({
      responsable: 'Ana Ruiz', novedades: 'Turno tranquilo.',
      incidentes: [{ hora: '', tipo: 'observacion', descripcion: 'Luz fundida en lobby' }],
    })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('sin responsable no guarda y la ventana sigue abierta', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva entrada' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }))
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' }))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Nueva entrada' })).toBeTruthy()
  })

  it('sin permisos no hay nueva entrada, firmar ni eliminar; el detalle se puede ver', () => {
    renderTab({ canCreate: false, canEdit: false, canDelete: false })
    expect(screen.queryByRole('button', { name: '+ Nueva entrada' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Firmar' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Eliminar entrada/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Imprimir entrada/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /2026-10-20.*Carlos Pérez/ }))
    expect(screen.getByRole('dialog', { name: '🌙 2026-10-20 — noche' })).toBeTruthy()
  })
})
