// PersonalTab — el formulario (nuevo y editar) abre en ventana emergente y el buscador
// acota las tarjetas por nombre, teléfono, DPI, email o tag sin distinguir acentos ni
// mayúsculas, combinado con los filtros de estado y cargo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { PersonalCondominio, UsuarioAsignablePersonal } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null as { message: string } | null })),
  updateCondominioRow: vi.fn(async () => ({ error: null as { message: string } | null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null as { message: string } | null })),
  fetchUsuariosAsignablesPersonal: vi.fn(async () => ({
    data: [] as UsuarioAsignablePersonal[],
    error: null as { message: string } | null,
  })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: () => ({}), rpc: () => ({}), storage: { from: () => ({}) } },
  db: { from: () => ({}), rpc: () => ({}) },
}))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({
  fetchUsuariosAsignablesPersonal: mocks.fetchUsuariosAsignablesPersonal,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

const { PersonalTab } = await import('../PersonalTab')

function empleado(over: Partial<PersonalCondominio> = {}): PersonalCondominio {
  return {
    id: 'emp1', company_id: 'c1', project_id: 'p1', nombre: 'Dina Villatoro',
    cargo: 'conserje', turno: 'diurno', estado: 'activo',
    created_at: '2026-01-02T00:00:00.000Z',
    ...over,
  } as PersonalCondominio
}

const personal = [
  empleado(),
  empleado({ id: 'emp2', nombre: 'José Pérez', cargo: 'guardia', telefono: '5555-1234', tags: ['Nocturno'] }),
  empleado({ id: 'emp3', nombre: 'Ana López', cargo: 'jardinero', estado: 'vacaciones', dpi: '1234567890101' }),
]

function renderTab(props: Partial<Parameters<typeof PersonalTab>[0]> = {}) {
  const onRefresh = vi.fn()
  render(
    <PersonalTab personal={personal} proyectoId="p1" companyId="c1" moneda="Q"
      canCreate canEdit canDelete onRefresh={onRefresh} {...props} />,
  )
  return { onRefresh }
}
const buscador = () => screen.getByRole('searchbox', { name: 'Buscar empleado' })
const nombresVisibles = () => personal.filter(p => screen.queryByText(p.nombre)).map(p => p.nombre)

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockClear())
  mocks.createCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.fetchUsuariosAsignablesPersonal.mockResolvedValue({ data: [], error: null })
})
afterEach(() => { cleanup() })

describe('PersonalTab — buscador', () => {
  it('acota las tarjetas por nombre sin distinguir mayúsculas ni acentos', () => {
    renderTab()
    // El filtro de estado arranca en «activo»: Ana (vacaciones) no se ve.
    expect(nombresVisibles()).toEqual(['Dina Villatoro', 'José Pérez'])
    fireEvent.change(buscador(), { target: { value: 'PEREZ' } })
    expect(nombresVisibles()).toEqual(['José Pérez'])
    fireEvent.change(buscador(), { target: { value: 'dína' } })
    expect(nombresVisibles()).toEqual(['Dina Villatoro'])
    fireEvent.change(buscador(), { target: { value: '' } })
    expect(nombresVisibles()).toEqual(['Dina Villatoro', 'José Pérez'])
  })

  it('también busca por teléfono, DPI y tag, y se combina con los filtros de estado y cargo', () => {
    renderTab()
    fireEvent.change(buscador(), { target: { value: '5555' } })
    expect(nombresVisibles()).toEqual(['José Pérez'])
    fireEvent.change(buscador(), { target: { value: 'nocturno' } })
    expect(nombresVisibles()).toEqual(['José Pérez'])
    // Ana está de vacaciones: sólo aparece al cambiar el filtro de estado.
    fireEvent.change(buscador(), { target: { value: '1234567890101' } })
    expect(nombresVisibles()).toEqual([])
    expect(screen.getByText('Nadie coincide con «1234567890101» y los filtros')).toBeTruthy()
    fireEvent.click(screen.getByText('Todos (3)'))
    expect(nombresVisibles()).toEqual(['Ana López'])
    // Y con el cargo equivocado vuelve a quedar vacío.
    fireEvent.change(screen.getByLabelText('Filtrar por cargo'), { target: { value: 'guardia' } })
    expect(nombresVisibles()).toEqual([])
  })

  it('sin personal registrado conserva el mensaje de siempre', () => {
    renderTab({ personal: [] })
    expect(screen.getByText('No hay personal registrado')).toBeTruthy()
  })
})

describe('PersonalTab — formulario en ventana emergente', () => {
  it('+ Agregar Personal abre un diálogo con el formulario en blanco; Cancelar lo cierra y descarta el borrador', async () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Agregar Personal'))
    const ventana = screen.getByRole('dialog', { name: 'Nuevo Empleado' })
    await within(ventana).findByLabelText('Cuenta con la que ingresa')
    expect((within(ventana).getByLabelText('Nombre *') as HTMLInputElement).value).toBe('')
    // El botón de alta sigue visible y las tarjetas siguen detrás.
    expect(screen.getByText('+ Agregar Personal')).toBeTruthy()
    expect(screen.getByText('Dina Villatoro')).toBeTruthy()
    fireEvent.change(within(ventana).getByLabelText('Nombre *'), { target: { value: 'Borrador' } })
    fireEvent.click(within(ventana).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('+ Agregar Personal'))
    expect((screen.getByLabelText('Nombre *') as HTMLInputElement).value).toBe('')
  })

  it('✏️ abre el diálogo de edición con los datos del empleado y Escape lo cierra sin guardar', async () => {
    renderTab({ personal: [personal[1]] })
    fireEvent.click(screen.getByText('✏️'))
    const ventana = screen.getByRole('dialog', { name: 'Editar Empleado' })
    await within(ventana).findByLabelText('Cuenta con la que ingresa')
    expect((within(ventana).getByLabelText('Nombre *') as HTMLInputElement).value).toBe('José Pérez')
    expect((within(ventana).getByLabelText('Teléfono') as HTMLInputElement).value).toBe('5555-1234')
    expect((within(ventana).getByLabelText('Cargo del empleado') as HTMLSelectElement).value).toBe('guardia')
    expect(within(ventana).getByRole('button', { name: 'Actualizar' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('Agregar guarda, cierra la ventana y refresca', async () => {
    const { onRefresh } = renderTab()
    fireEvent.click(screen.getByText('+ Agregar Personal'))
    const ventana = screen.getByRole('dialog', { name: 'Nuevo Empleado' })
    await within(ventana).findByLabelText('Cuenta con la que ingresa')
    fireEvent.change(within(ventana).getByLabelText('Nombre *'), { target: { value: 'Nuevo Empleado X' } })
    fireEvent.click(within(ventana).getByRole('button', { name: 'Agregar' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('personal_condominio', expect.objectContaining({ nombre: 'Nuevo Empleado X' })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})
