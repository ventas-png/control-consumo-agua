import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { ActaReunion, Asamblea } from '../../../../types'

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

const { ActasTab } = await import('../ActasTab')

function acta(over: Partial<ActaReunion> = {}): ActaReunion {
  return {
    id: 'a1', company_id: 'co1', project_id: 'p1',
    titulo: 'Asamblea Ordinaria Q1', tipo: 'ordinaria', fecha: '2026-03-15',
    hora_inicio: '18:00', hora_fin: '20:00', lugar: 'Salón social', quorum: 30, quorum_requerido: 25,
    asistentes: [{ nombre: 'Ana Pérez', unidad: 'Casa 4', rol: 'Presidenta' }],
    orden_del_dia: [{ punto: 'Presupuesto 2026', descripcion: 'Revisión de gastos', acuerdo: 'Se aprueba el presupuesto' }],
    acuerdos: 'Subir la cuota un 5%', observaciones: null, redactada_por: 'Luis Gómez', aprobada: false,
    created_at: '2026-03-15T20:00:00Z',
    ...over,
  } as unknown as ActaReunion
}

function renderTab(props: Partial<Parameters<typeof ActasTab>[0]> = {}) {
  return render(
    <ActasTab actas={[acta()]} proyectoId="p1" companyId="co1" canCreate canEdit canDelete onRefresh={() => {}} {...props} />,
  )
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('ActasTab — ventanas', () => {
  it('cada acta se abre en ventana (pantalla completa en el teléfono) y Escape la cierra', () => {
    renderTab()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^📋 Asamblea Ordinaria Q1/ }))

    const dialog = screen.getByRole('dialog', { name: 'Asamblea Ordinaria Q1' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText(/Ana Pérez — Casa 4 \(Presidenta\)/)).toBeTruthy()
    expect(within(dialog).getByText('✓ Se aprueba el presupuesto')).toBeTruthy()
    expect(within(dialog).getByText('Subir la cuota un 5%')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('aprobar desde la ventana actualiza el acta y la ventana muestra el dato vigente', async () => {
    const onRefresh = vi.fn()
    const { rerender } = renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: /^📋 Asamblea Ordinaria Q1/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '✓ Aprobar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('actas_reunion', 'a1', { aprobada: true }))
    expect(onRefresh).toHaveBeenCalled()

    // Al refrescar, la ventana lee la fila nueva (no una copia del clic).
    rerender(<ActasTab actas={[acta({ aprobada: true })]} proyectoId="p1" companyId="co1" canCreate canEdit canDelete onRefresh={onRefresh} />)
    const dialog = screen.getByRole('dialog', { name: 'Asamblea Ordinaria Q1' })
    expect(within(dialog).getByRole('button', { name: '↩ Quitar aprobación' })).toBeTruthy()
    expect(within(dialog).getByText('✓ Aprobada')).toBeTruthy()
  })

  it('el formulario de nueva acta es una ventana y guardar crea el acta', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva Acta' }))
    const dialog = screen.getByRole('dialog', { name: 'Nueva acta' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Título *'), { target: { value: 'Junta de marzo' } })
    fireEvent.change(within(dialog).getByLabelText('Nombre del asistente 1'), { target: { value: 'Marta Ruiz' } })
    fireEvent.change(within(dialog).getByLabelText('Punto 1'), { target: { value: 'Seguridad' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('actas_reunion', expect.objectContaining({
      titulo: 'Junta de marzo', company_id: 'co1', project_id: 'p1',
      asistentes: [{ nombre: 'Marta Ruiz', unidad: '', rol: '' }],
      orden_del_dia: [{ punto: 'Seguridad', descripcion: '', acuerdo: '' }],
    })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('editar desde la ventana cambia al formulario con los datos del acta', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /^📋 Asamblea Ordinaria Q1/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '✏️ Editar' }))

    const dialog = screen.getByRole('dialog', { name: 'Editar acta' })
    expect((within(dialog).getByLabelText('Título *') as HTMLInputElement).value).toBe('Asamblea Ordinaria Q1')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('actas_reunion', 'a1', expect.objectContaining({ titulo: 'Asamblea Ordinaria Q1' })))
  })

  it('sin permiso de edición no hay acciones en la fila ni al pie de la ventana', () => {
    renderTab({ canCreate: false, canEdit: false, canDelete: false })
    expect(screen.queryByRole('button', { name: '+ Nueva Acta' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Eliminar/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Imprimir/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^📋 Asamblea Ordinaria Q1/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: /Imprimir|Editar|Aprobar/ })).toBeNull()
    expect(within(dialog).getByText('Subir la cuota un 5%')).toBeTruthy()
  })
})

// ── Fase 3: el acta formal de una asamblea finalizada se liga a ella ─────────
function asamblea(over: Partial<Asamblea> = {}): Asamblea {
  return {
    id: 'as1', company_id: 'co1', project_id: 'p1', titulo: 'Ordinaria de octubre', tipo: 'ordinaria',
    fecha: '2026-10-20', hora_inicio: '18:00', estado: 'finalizada', quorum_requerido: 50,
    created_at: '2026-10-01T10:00:00Z',
    ...over,
  } as unknown as Asamblea
}

describe('ActasTab — acta de una asamblea', () => {
  const asambleas = [
    asamblea(),
    asamblea({ id: 'as2', titulo: 'Ordinaria de septiembre', fecha: '2026-09-20' }),
    asamblea({ id: 'as3', titulo: 'Programada de noviembre', estado: 'programada' }),
  ]

  it('sólo ofrece las asambleas finalizadas que aún no tienen acta, y guarda la elegida', async () => {
    renderTab({ asambleas, actas: [acta({ id: 'ac2', titulo: 'Acta — Ordinaria de septiembre', asamblea_id: 'as2' })] })
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva Acta' }))
    const dialog = screen.getByRole('dialog', { name: 'Nueva acta' })
    const select = within(dialog).getByLabelText('Asamblea')
    expect(within(select).getAllByRole('option').map(o => o.textContent))
      .toEqual(['— Ninguna (junta, comité…) —', 'Ordinaria de octubre (2026-10-20)'])

    fireEvent.change(within(dialog).getByLabelText('Título *'), { target: { value: 'Acta — Ordinaria de octubre' } })
    fireEvent.change(select, { target: { value: 'as1' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('actas_reunion', expect.objectContaining({
      titulo: 'Acta — Ordinaria de octubre', asamblea_id: 'as1',
    })))
  })

  it('un acta suelta guarda la asamblea vacía; al editar la ligada conserva la suya', async () => {
    renderTab({ asambleas, actas: [acta({ asamblea_id: 'as2' })] })
    fireEvent.click(screen.getByRole('button', { name: /^📋 Asamblea Ordinaria Q1/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '✏️ Editar' }))
    const dialog = screen.getByRole('dialog', { name: 'Editar acta' })
    expect((within(dialog).getByLabelText('Asamblea') as HTMLSelectElement).value).toBe('as2')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('actas_reunion', 'a1', expect.objectContaining({ asamblea_id: 'as2' })))
    cleanup()

    renderTab({ asambleas })
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva Acta' }))
    const nueva = screen.getByRole('dialog', { name: 'Nueva acta' })
    fireEvent.change(within(nueva).getByLabelText('Título *'), { target: { value: 'Junta de marzo' } })
    fireEvent.click(within(nueva).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('actas_reunion', expect.objectContaining({ asamblea_id: null })))
  })

  it('la lista y la ventana nombran la asamblea del acta', () => {
    renderTab({ asambleas, actas: [acta({ asamblea_id: 'as1' })] })
    expect(screen.getByText('🏛️ Ordinaria de octubre')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^📋 Asamblea Ordinaria Q1/ }))
    expect(within(screen.getByRole('dialog')).getByText(/De la asamblea «Ordinaria de octubre»/)).toBeTruthy()
  })
})
