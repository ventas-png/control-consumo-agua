import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { IncidenteSeguridad } from '../../../../types'

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
// jsPDF / xlsx no hacen falta para estas pruebas.
vi.mock('../../exportUtils', () => ({ exportarPDFTabla: vi.fn(), exportarExcel: vi.fn() }))

const { IncidentesTab } = await import('../IncidentesTab')

function incidente(over: Partial<IncidenteSeguridad> = {}): IncidenteSeguridad {
  return {
    id: 'i1', company_id: 'co1', project_id: 'p1', fecha: '2026-10-19', hora: '23:40',
    tipo: 'vandalismo', descripcion: 'Grafiti en el muro del parqueo', area: 'Parqueo 3',
    reportado_por: 'Guardia nocturno', estado: 'reportado', involucrados: 'Desconocidos',
    seguimiento: 'Se revisan las cámaras.', created_at: '2026-10-20T00:00:00Z',
    ...over,
  }
}

function renderTab(props: Partial<Parameters<typeof IncidentesTab>[0]> = {}) {
  return render(
    <IncidentesTab incidentes={[incidente()]} proyectoId="p1" companyId="co1"
      canCreate canEdit onRefresh={() => {}} {...props} />,
  )
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('IncidentesTab — ventanas', () => {
  it('la lista ocupa la página y cada incidente se abre en ventana; Escape la cierra', () => {
    renderTab()
    expect(screen.queryByText(/Selecciona un incidente/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Grafiti en el muro del parqueo/ }))

    const dialog = screen.getByRole('dialog', { name: '🔨 Grafiti en el muro del parqueo' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText('Guardia nocturno')).toBeTruthy()
    expect(within(dialog).getByText('Se revisan las cámaras.')).toBeTruthy()
    expect(within(dialog).getByText(/a las 23:40 · Parqueo 3/)).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('avanzar de estado desde la ventana, y la ventana muestra la fila refrescada', async () => {
    const onRefresh = vi.fn()
    const { rerender } = renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: /Grafiti en el muro/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '→ Iniciar Investigación' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('incidentes_seguridad', 'i1', { estado: 'investigando' }))
    expect(onRefresh).toHaveBeenCalled()

    // Llega la lista refrescada: la ventana lee la fila vigente, no una copia.
    rerender(<IncidentesTab incidentes={[incidente({ estado: 'investigando' })]} proyectoId="p1" companyId="co1"
      canCreate canEdit onRefresh={onRefresh} />)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: '→ Marcar Resuelto' })).toBeTruthy()
    expect(within(dialog).getByText('Investigando')).toBeTruthy()
  })

  it('registrar un incidente se hace en ventana y guardar llama a la mutación', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: '🚨 Registrar' }))
    const dialog = screen.getByRole('dialog', { name: 'Registrar incidente' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Descripción *'), { target: { value: 'Puerta forzada en bodega' } })
    fireEvent.change(within(dialog).getByLabelText('Área'), { target: { value: 'Bodega' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('incidentes_seguridad', expect.objectContaining({
      descripcion: 'Puerta forzada en bodega', area: 'Bodega', company_id: 'co1', project_id: 'p1',
    })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('editar desde el detalle abre el formulario con los datos y, al cerrarlo, vuelve el detalle', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /Grafiti en el muro/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '✏️ Editar' }))

    const form = screen.getByRole('dialog', { name: 'Editar incidente' })
    expect((within(form).getByLabelText('Área') as HTMLInputElement).value).toBe('Parqueo 3')
    fireEvent.change(within(form).getByLabelText('Seguimiento'), { target: { value: 'Denuncia presentada.' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('incidentes_seguridad', 'i1', expect.objectContaining({
      seguimiento: 'Denuncia presentada.',
    })))
    await waitFor(() => expect(screen.getByRole('dialog', { name: /Grafiti en el muro/ })).toBeTruthy())
  })

  it('sin permiso de edición no hay editar ni avance de estado; sin crear no hay registrar', () => {
    renderTab({ canCreate: false, canEdit: false })
    expect(screen.queryByRole('button', { name: '🚨 Registrar' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Grafiti en el muro/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: /Editar/ })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /Iniciar Investigación/ })).toBeNull()
  })

  it('los filtros siguen filtrando la lista', () => {
    renderTab({ incidentes: [incidente(), incidente({ id: 'i2', descripcion: 'Caída en escaleras', tipo: 'accidente', area: 'Torre B' })] })
    fireEvent.change(screen.getByLabelText('Buscar por área'), { target: { value: 'torre' } })
    expect(screen.queryByRole('button', { name: /Grafiti/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Caída en escaleras/ })).toBeTruthy()
  })
})
