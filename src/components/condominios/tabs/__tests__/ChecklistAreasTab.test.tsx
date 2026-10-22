import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { AreaCondominio, ChecklistArea } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRowAfectando: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRowAfectando: mocks.deleteCondominioRowAfectando,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

const { ChecklistAreasTab } = await import('../ChecklistAreasTab')

const areas = [{
  id: 'area1', company_id: 'co1', project_id: 'p1', nombre: 'Piscina', descripcion: null,
  icono: '🏊', orden: 0, activo: true, created_at: '2026-01-01T00:00:00Z',
}] as AreaCondominio[]

function checklist(over: Partial<ChecklistArea> = {}): ChecklistArea {
  return {
    id: 'c1', company_id: 'co1', project_id: 'p1', area: 'Piscina', area_id: 'area1',
    fecha: '2026-10-20', inspector: 'Ana', estado: 'con_observaciones', notas: 'Revisar filtro',
    items: [
      { item: 'Bombas de agua', ok: false, observacion: 'Ruido' },
      { item: 'Iluminación exterior', ok: true, observacion: '' },
    ],
    created_at: '2026-10-20T00:00:00Z',
    ...over,
  }
}

type Props = Parameters<typeof ChecklistAreasTab>[0]
function props(over: Partial<Props> = {}): Props {
  return {
    checklists: [checklist()], areas, proyectoId: 'p1', companyId: 'co1',
    canCreate: true, canEdit: true, canDelete: true, puedeConfigurarAreas: true,
    onIrATab: () => {}, onRefresh: () => {}, ...over,
  }
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('ChecklistAreasTab — ventanas', () => {
  it('cada checklist se abre en ventana (pantalla completa en el teléfono)', () => {
    render(<ChecklistAreasTab {...props()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Piscina.*2026-10-20/ }))

    const dialog = screen.getByRole('dialog', { name: '🏊 Piscina' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText('1/2 ítems completados')).toBeTruthy()
    expect(within(dialog).getByText('Revisar filtro')).toBeTruthy()
    expect(within(dialog).getByText(/Inspector: Ana/)).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('marcar un ítem en la ventana lo guarda y se ve al instante', async () => {
    const onRefresh = vi.fn()
    render(<ChecklistAreasTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: /Piscina.*2026-10-20/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Bombas de agua' }))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('checklist_areas', 'c1', expect.objectContaining({ estado: 'completo' })))
    expect(onRefresh).toHaveBeenCalled()
    await waitFor(() => expect((within(dialog).getByRole('checkbox', { name: 'Bombas de agua' }) as HTMLInputElement).checked).toBe(true))
    expect(within(dialog).getByText('2/2 ítems completados')).toBeTruthy()
  })

  it('la ventana muestra la fila vigente tras refrescar (no una copia vieja)', () => {
    const { rerender } = render(<ChecklistAreasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: /Piscina.*2026-10-20/ }))
    expect(within(screen.getByRole('dialog')).getByText('Revisar filtro')).toBeTruthy()

    rerender(<ChecklistAreasTab {...props({ checklists: [checklist({ notas: 'Filtro cambiado' })] })} />)
    expect(within(screen.getByRole('dialog')).getByText('Filtro cambiado')).toBeTruthy()
  })

  it('el formulario de nuevo checklist es una ventana y guarda', async () => {
    render(<ChecklistAreasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo checklist' }))
    const dialog = screen.getByRole('dialog', { name: 'Nuevo checklist de área' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Área'), { target: { value: 'area1' } })
    fireEvent.change(within(dialog).getByLabelText('Inspector'), { target: { value: 'Beto' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('checklist_areas', expect.objectContaining({ area_id: 'area1', inspector: 'Beto' })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('editar reemplaza la ventana del detalle y al cancelar se vuelve a él', () => {
    render(<ChecklistAreasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: /Piscina.*2026-10-20/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '✏️ Editar' }))

    const form = screen.getByRole('dialog', { name: 'Editar checklist' })
    expect((within(form).getByLabelText('Inspector') as HTMLInputElement).value).toBe('Ana')
    fireEvent.click(within(form).getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('dialog', { name: '🏊 Piscina' })).toBeTruthy()
  })

  it('sin permiso de edición los ítems no se pueden marcar ni editar', () => {
    render(<ChecklistAreasTab {...props({ canCreate: false, canEdit: false })} />)
    expect(screen.queryByRole('button', { name: '+ Nuevo checklist' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Piscina.*2026-10-20/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: '✏️ Editar' })).toBeNull()
  })

  it('eliminar exige su propio permiso: editar no basta', async () => {
    render(<ChecklistAreasTab {...props({ canDelete: false })} />)
    fireEvent.click(screen.getByRole('button', { name: /Piscina.*2026-10-20/ }))
    let dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: '✏️ Editar' })).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: /Eliminar/ })).toBeNull()
    cleanup()

    render(<ChecklistAreasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: /Piscina.*2026-10-20/ }))
    dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Eliminar/ }))
    await waitFor(() => expect(mocks.deleteCondominioRowAfectando).toHaveBeenCalledWith('checklist_areas', 'c1'))
  })
})
