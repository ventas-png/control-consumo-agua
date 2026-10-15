// El responsable de un servicio de housekeeping es un usuario ELEGIBLE del proyecto
// (20261030000100). La pantalla preselecciona al conectado si es elegible, ofrece
// un buscador sobre el catálogo del servidor, exige un responsable válido al crear,
// limpia y recarga la selección al cambiar de proyecto, empresa o sesión, y muestra
// los responsables heredados (texto) sin vincularlos.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { ServicioHousekeeping, Unidad } from '../../../../types'
import type { AppUser } from '../../../../domain/usuarios/queries'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (_t: string, _p: Record<string, unknown>) => ({ error: null as null | { message: string } })),
  updateCondominioRow: vi.fn(async (_t: string, _id: string, _p: Record<string, unknown>) => ({ error: null as null | { message: string } })),
  fetchResponsablesElegibles: vi.fn(async (_p: string) => ({ data: [] as AppUser[], error: null as string | null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: () => ({}), rpc: () => ({}), storage: { from: () => ({}) }, functions: { invoke: vi.fn() } },
  db: { from: () => ({}), rpc: () => ({}) },
}))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
}))
vi.mock('../../../../domain/condominios/housekeepingResponsable', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../domain/condominios/housekeepingResponsable')>()),
  fetchResponsablesElegibles: mocks.fetchResponsablesElegibles,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
// UsuarioChip resuelve uuid → nombre con react-query; aquí basta con ver el id.
vi.mock('../../../shared/UsuarioChip', () => ({ UsuarioChip: ({ userId }: { userId: string }) => <span>chip:{userId}</span> }))

const { HousekeepingTab } = await import('../HousekeepingTab')

const ana: AppUser = { id: 'u1', full_name: 'Ana Pérez', role: 'operator', activo: true }
const beto: AppUser = { id: 'u2', full_name: 'Beto López', role: 'admin', activo: true }

function servicio(over: Partial<ServicioHousekeeping> = {}): ServicioHousekeeping {
  return {
    id: 's1', company_id: 'c1', project_id: 'p1', tipo: 'limpieza_estandar', fecha: '2026-10-15',
    estado: 'pendiente', created_at: '2026-10-15T00:00:00.000Z', ...over,
  }
}

function renderTab(props: Partial<Parameters<typeof HousekeepingTab>[0]> = {}) {
  return render(
    <HousekeepingTab
      servicios={[]} unidades={[] as Unidad[]} proyectoId="p1" companyId="c1" userId="u1" moneda="Q"
      canCreate canEdit onRefresh={() => {}} {...props} />,
  )
}

async function abrirAlta() {
  await waitFor(() => expect(mocks.fetchResponsablesElegibles).toHaveBeenCalled())
  fireEvent.click(screen.getByText('+ Nuevo Servicio'))
}

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockClear())
  mocks.fetchResponsablesElegibles.mockResolvedValue({ data: [ana, beto], error: null })
  mocks.createCondominioRow.mockResolvedValue({ error: null })
})
afterEach(() => { cleanup() })

describe('HousekeepingTab — responsable como usuario', () => {
  it('pide el catálogo de ELEGIBLES del proyecto (no la empresa entera) al montar', async () => {
    renderTab()
    await waitFor(() => expect(mocks.fetchResponsablesElegibles).toHaveBeenCalledWith('p1'))
  })

  it('al crear, preselecciona al usuario conectado si es elegible y lo manda como responsable_user_id (nunca el texto)', async () => {
    renderTab()
    await abrirAlta()
    const elegido = await screen.findByTestId('responsable-elegido')
    expect(elegido.textContent).toContain('Ana Pérez (tú)')
    fireEvent.click(screen.getByText('Agregar'))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const payload = mocks.createCondominioRow.mock.calls[0][1]
    expect(payload.responsable_user_id).toBe('u1')
    expect(payload).not.toHaveProperty('responsable')
  })

  it('si el creador NO es elegible, no preselecciona a nadie y exige elegir un responsable válido', async () => {
    renderTab({ userId: 'u9' })
    await abrirAlta()
    expect(screen.queryByTestId('responsable-elegido')).toBeNull()
    fireEvent.click(screen.getByText('Agregar'))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning', title: 'Responsable requerido' }))
    // elige a otro usuario autorizado con el buscador
    fireEvent.change(screen.getByLabelText('Buscar responsable'), { target: { value: 'bet' } })
    const lista = screen.getByRole('listbox', { name: 'Responsables elegibles' })
    expect(within(lista).queryByText(/Ana Pérez/)).toBeNull()
    fireEvent.click(within(lista).getByText(/Beto López/))
    expect(screen.getByTestId('responsable-elegido').textContent).toContain('Beto López')
    fireEvent.click(screen.getByText('Agregar'))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow.mock.calls[0][1].responsable_user_id).toBe('u2')
  })

  it('el buscador solo ofrece lo que el servidor devolvió; sin coincidencias lo dice', async () => {
    renderTab({ userId: 'u9' })
    await abrirAlta()
    fireEvent.change(screen.getByLabelText('Buscar responsable'), { target: { value: 'zzz' } })
    expect(screen.getByText('Sin coincidencias.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Buscar responsable'), { target: { value: '' } })
    const lista = screen.getByRole('listbox', { name: 'Responsables elegibles' })
    expect(within(lista).getAllByRole('option')).toHaveLength(2)
  })

  it('al cambiar de proyecto cierra el formulario, limpia la selección y vuelve a pedir el catálogo', async () => {
    const { rerender } = renderTab()
    await abrirAlta()
    await screen.findByTestId('responsable-elegido')
    mocks.fetchResponsablesElegibles.mockResolvedValueOnce({ data: [], error: null })
    rerender(
      <HousekeepingTab servicios={[]} unidades={[] as Unidad[]} proyectoId="p2" companyId="c1" userId="u1" moneda="Q"
        canCreate canEdit onRefresh={() => {}} />,
    )
    await waitFor(() => expect(mocks.fetchResponsablesElegibles).toHaveBeenLastCalledWith('p2'))
    expect(screen.queryByText('Agregar')).toBeNull()          // formulario cerrado
    fireEvent.click(screen.getByText('+ Nuevo Servicio'))
    expect(screen.queryByTestId('responsable-elegido')).toBeNull()   // nadie preseleccionado: u1 no es elegible en p2
    fireEvent.focus(screen.getByLabelText('Buscar responsable'))
    expect(await screen.findByText('Nadie es elegible en este proyecto.')).toBeTruthy()
  })

  it('al cambiar de sesión (otro usuario) o de empresa también recarga y cierra', async () => {
    const { rerender } = renderTab()
    await abrirAlta()
    rerender(
      <HousekeepingTab servicios={[]} unidades={[] as Unidad[]} proyectoId="p1" companyId="c1" userId="u2" moneda="Q"
        canCreate canEdit onRefresh={() => {}} />,
    )
    await waitFor(() => expect(mocks.fetchResponsablesElegibles).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Agregar')).toBeNull()
    rerender(
      <HousekeepingTab servicios={[]} unidades={[] as Unidad[]} proyectoId="p1" companyId="c2" userId="u2" moneda="Q"
        canCreate canEdit onRefresh={() => {}} />,
    )
    await waitFor(() => expect(mocks.fetchResponsablesElegibles).toHaveBeenCalledTimes(3))
  })

  it('un responsable heredado (texto) se muestra como «anterior sin vincular» y no se vincula solo al editar', async () => {
    renderTab({ servicios: [servicio({ responsable: 'Juan Viejo' })] })
    expect(screen.getByText(/Responsable anterior sin vincular: Juan Viejo/)).toBeTruthy()
    await waitFor(() => expect(mocks.fetchResponsablesElegibles).toHaveBeenCalled())
    fireEvent.click(screen.getByText('✏️'))
    expect(screen.queryByTestId('responsable-elegido')).toBeNull()
    expect(screen.getByText(/Elige un usuario para vincularlo/)).toBeTruthy()
    fireEvent.click(screen.getByText('Actualizar'))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const patch = mocks.updateCondominioRow.mock.calls[0][2]
    expect(patch.responsable_user_id).toBeNull()
    expect(patch).not.toHaveProperty('responsable')
  })

  it('un responsable vinculado que ya no es elegible se marca «requiere reasignación»; uno vigente no', async () => {
    renderTab({ servicios: [servicio({ id: 's1', responsable_user_id: 'u9' }), servicio({ id: 's2', responsable_user_id: 'u2' })] })
    expect(await screen.findByText('requiere reasignación')).toBeTruthy()
    expect(screen.getAllByText('requiere reasignación')).toHaveLength(1)
    expect(screen.getByText('chip:u2')).toBeTruthy()
  })

  it('si la base rechaza al responsable (HK_RESPONSABLE_NO_ELEGIBLE) lo explica y recarga el catálogo', async () => {
    mocks.createCondominioRow.mockResolvedValueOnce({ error: { message: 'HK_RESPONSABLE_NO_ELEGIBLE: el responsable debe ser…' } })
    renderTab()
    await abrirAlta()
    await screen.findByTestId('responsable-elegido')
    fireEvent.click(screen.getByText('Agregar'))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: expect.stringMatching(/habilitado de la empresa/) })))
    await waitFor(() => expect(mocks.fetchResponsablesElegibles).toHaveBeenCalledTimes(2))
  })

  it('si el servidor niega el catálogo (sin autorización en el proyecto) la pantalla lo dice', async () => {
    mocks.fetchResponsablesElegibles.mockResolvedValue({ data: [], error: 'No autorizado' })
    renderTab()
    await abrirAlta()
    expect(screen.getByRole('alert').textContent).toContain('No autorizado')
  })
})
