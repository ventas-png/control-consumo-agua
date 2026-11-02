import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { PersonalCondominio } from '../../../../types'

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

const { default: CapacitacionPersonalTab } = await import('../CapacitacionPersonalTab')

function emp(id: string, nombre: string, estado: PersonalCondominio['estado'], cargo = 'conserje'): PersonalCondominio {
  return { id, company_id: 'co1', project_id: 'p1', nombre, cargo, turno: 'diurno', estado } as PersonalCondominio
}

const personal = [
  emp('e1', 'Lucía Conserje', 'activo'),
  emp('e2', 'Pedro Guardia', 'inactivo', 'guardia'),
  emp('e3', 'Ana Jardinera', 'vacaciones', 'jardinero'),
]

function abrirForm() {
  render(
    <CapacitacionPersonalTab capacitaciones={[]} personal={personal}
      cargos={[{ id: 'c1', codigo: 'conserje', nombre: 'Conserje de lobby' } as never]}
      proyectoId="p1" companyId="co1" moneda="Q" canCreate canEdit canDelete onRefresh={() => {}} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Nueva capacitación/ }))
  return screen.getByLabelText('Empleado *') as HTMLSelectElement
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('CapacitacionPersonalTab — empleado del expediente', () => {
  it('ofrece sólo el personal que no está inactivo, por nombre', () => {
    const sel = abrirForm()
    const nombres = [...sel.options].filter(o => o.value).map(o => o.value)
    expect(nombres).toEqual(['e3', 'e1'])
  })

  it('al elegir, guarda el vínculo al empleado y llena el cargo con su nombre de catálogo', async () => {
    const sel = abrirForm()
    fireEvent.change(sel, { target: { value: 'e1' } })
    expect((screen.getByPlaceholderText(/Guardia, Conserje/) as HTMLInputElement).value).toBe('Conserje de lobby')
    fireEvent.change(screen.getByPlaceholderText(/Primeros auxilios/), { target: { value: 'Primeros auxilios' } })
    fireEvent.click(screen.getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow).toHaveBeenCalledWith('capacitacion_personal_cond', expect.objectContaining({
      personal_id: 'e1', nombre_empleado: 'Lucía Conserje', cargo: 'Conserje de lobby', curso: 'Primeros auxilios',
    }))
  })

  it('sin empleado elegido no registra', () => {
    abrirForm()
    fireEvent.change(screen.getByPlaceholderText(/Primeros auxilios/), { target: { value: 'Primeros auxilios' } })
    fireEvent.click(screen.getByRole('button', { name: /Registrar/ }))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' }))
  })
})
