// Alta/edición de un servicio en ventana emergente: sin selector de estado (lo mueven Iniciar
// y Finalizar), reserva STR opcional que rellena la unidad vacía, responsable obligatorio al
// crear, hora tentativa de ingreso, cancelación de un servicio pendiente/en proceso y
// mensajes legibles cuando la base rechaza.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { ReservaSTRVinculable, ServicioHousekeeping, Unidad } from '../../../../types'
import type { AppUser } from '../../../../domain/usuarios/queries'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (_t: string, _p: Record<string, unknown>) => ({ error: null as null | { message: string } })),
  updateCondominioRow: vi.fn(async (_t: string, _id: string, _p: Record<string, unknown>) => ({ error: null as null | { message: string } })),
  updateCondominioRowAfectando: vi.fn(async (_t: string, _id: string, _p: Record<string, unknown>) => ({ error: null as null | { message: string; code?: string } })),
  fetchReservasVinculables: vi.fn(async (_p: string) => ({ data: [] as ReservaSTRVinculable[], error: null as string | null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}), rpc: () => ({}) }, db: { from: () => ({}), rpc: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  updateCondominioRowAfectando: mocks.updateCondominioRowAfectando,
}))
vi.mock('../../../../domain/condominios/housekeepingReservas', () => ({ fetchReservasVinculables: mocks.fetchReservasVinculables }))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

const { HousekeepingServicioModal } = await import('../HousekeepingServicioModal')

const ana: AppUser = { id: 'u1', full_name: 'Ana Pérez', role: 'operator', activo: true }
const beto: AppUser = { id: 'u2', full_name: 'Beto López', role: 'admin', activo: true }
const unidades = [{ id: 'un1', nombre: 'Apto 1A' }, { id: 'un2', nombre: 'Apto 2B' }] as Unidad[]
const r1: ReservaSTRVinculable = { id: 'r1', codigo_confirmacion: 'HM-001', huesped_nombre: 'Ana Pérez', fecha_entrada: '2026-11-08', fecha_salida: '2026-11-12', hora_llegada_estimada: '15:00:00', hora_salida_estimada: null, estado: 'en_curso', unidad_id: 'un1', unidad_nombre: 'Apto 1A', plataforma: 'airbnb' }
const r2: ReservaSTRVinculable = { id: 'r2', codigo_confirmacion: 'HM-002', huesped_nombre: 'Luis Gómez', fecha_entrada: '2026-11-20', fecha_salida: '2026-11-25', hora_llegada_estimada: null, hora_salida_estimada: null, estado: 'confirmada', unidad_id: 'un2', unidad_nombre: 'Apto 2B', plataforma: 'booking' }

function servicio(over: Partial<ServicioHousekeeping> = {}): ServicioHousekeeping {
  return { id: 's1', company_id: 'c1', project_id: 'p1', tipo: 'limpieza_estandar', fecha: '2026-10-15', estado: 'pendiente', created_at: '2026-10-15T00:00:00.000Z', ...over }
}

function abrir(props: Partial<Parameters<typeof HousekeepingServicioModal>[0]> = {}) {
  const onClose = vi.fn(); const onSaved = vi.fn(); const onRecargarElegibles = vi.fn()
  render(
    <HousekeepingServicioModal servicio={null} unidades={unidades} proyectoId="p1" companyId="c1" userId="u1" moneda="Q"
      elegibles={[ana, beto]} cargandoElegibles={false} elegiblesError={null} onRecargarElegibles={onRecargarElegibles}
      onClose={onClose} onSaved={onSaved} {...props} />,
  )
  return { onClose, onSaved, onRecargarElegibles }
}

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockClear())
  mocks.fetchReservasVinculables.mockResolvedValue({ data: [r1, r2], error: null })
  mocks.createCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRowAfectando.mockResolvedValue({ error: null })
  mocks.confirm.mockResolvedValue({ isConfirmed: true })
})
afterEach(() => cleanup())

describe('HousekeepingServicioModal', () => {
  it('al crear no manda estado ni resumen de reserva; sí fecha, hora tentativa, responsable preseleccionado y reserva nula', async () => {
    const { onSaved, onClose } = abrir()
    expect(screen.queryByLabelText('Estado')).toBeNull()
    expect(screen.queryByRole('combobox', { name: /estado/i })).toBeNull()
    await screen.findByTestId('responsable-elegido')
    fireEvent.change(screen.getByLabelText('Hora tentativa de ingreso'), { target: { value: '09:30' } })
    fireEvent.click(screen.getByText('Agregar'))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const payload = mocks.createCondominioRow.mock.calls[0][1]
    expect(payload).not.toHaveProperty('estado')
    expect(payload).not.toHaveProperty('reserva_str_resumen')
    expect(payload).not.toHaveProperty('responsable')
    expect(payload.responsable_user_id).toBe('u1')
    expect(payload.hora_inicio).toBe('09:30')
    expect(payload.reserva_str_id).toBeNull()
    expect(onSaved).toHaveBeenCalled(); expect(onClose).toHaveBeenCalled()
  })

  it('pide el catálogo de reservas vinculables del proyecto y, al elegir una, rellena la unidad vacía y la manda', async () => {
    abrir()
    await waitFor(() => expect(mocks.fetchReservasVinculables).toHaveBeenCalledWith('p1'))
    fireEvent.focus(screen.getByLabelText('Buscar reserva'))
    const lista = await screen.findByRole('listbox', { name: 'Reservas vinculables' })
    fireEvent.click(within(lista).getByText(/HM-002/))
    expect(screen.getByTestId('reserva-elegida').textContent).toContain('HM-002 · Luis Gómez')
    expect((screen.getByLabelText('Unidad') as HTMLSelectElement).value).toBe('un2')
    fireEvent.click(screen.getByText('Agregar'))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow.mock.calls[0][1]).toMatchObject({ reserva_str_id: 'r2', unidad_id: 'un2' })
  })

  it('una unidad ya elegida no se pisa al vincular una reserva de otra unidad (la base dirá si no coincide)', async () => {
    abrir()
    fireEvent.change(screen.getByLabelText('Unidad'), { target: { value: 'un1' } })
    fireEvent.focus(screen.getByLabelText('Buscar reserva'))
    fireEvent.click(within(await screen.findByRole('listbox', { name: 'Reservas vinculables' })).getByText(/HM-002/))
    expect((screen.getByLabelText('Unidad') as HTMLSelectElement).value).toBe('un1')
    mocks.createCondominioRow.mockResolvedValueOnce({ error: { message: 'HK_RESERVA_UNIDAD_DISTINTA: la unidad del servicio no coincide' } })
    fireEvent.click(screen.getByText('Agregar'))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'La unidad del servicio no coincide con la de la reserva.' })))
  })

  it('el buscador filtra por código, huésped o unidad y «Quitar» desvincula', async () => {
    abrir()
    fireEvent.change(await screen.findByLabelText('Buscar reserva'), { target: { value: 'gómez' } })
    const lista = screen.getByRole('listbox', { name: 'Reservas vinculables' })
    expect(within(lista).queryByText(/HM-001/)).toBeNull()
    fireEvent.click(within(lista).getByText(/HM-002/))
    fireEvent.click(screen.getByText('Quitar'))
    expect(screen.queryByTestId('reserva-elegida')).toBeNull()
  })

  it('sin responsable al crear no guarda y lo dice', async () => {
    abrir({ userId: 'u9' })
    fireEvent.click(screen.getByText('Agregar'))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning', title: 'Responsable requerido' }))
  })

  it('al editar carga el servicio, no manda estado, y «Cancelar servicio» confirma y mueve a cancelado exigiendo una fila', async () => {
    const resumen = { reserva_id: 'r1', codigo_confirmacion: 'HM-001', huesped_nombre: 'Ana Pérez', huesped_telefono: null, huesped_email: null, fecha_entrada: '2026-11-08', fecha_salida: '2026-11-12', hora_llegada_estimada: null, hora_salida_estimada: null, estado: 'en_curso', plataforma: 'airbnb', unidad_id: 'un1', vinculado_en: '2026-10-15T00:00:00Z' }
    const { onSaved } = abrir({ servicio: servicio({ unidad_id: 'un1', hora_inicio: '09:00:00', responsable_user_id: 'u2', reserva_str_id: 'r1', reserva_str_resumen: resumen, notas: 'ojo', estado: 'en_proceso' }) })
    expect((screen.getByLabelText('Hora tentativa de ingreso') as HTMLInputElement).value).toBe('09:00')
    // Antes de que llegue el catálogo, el chip usa el resumen sellado por la base.
    expect(screen.getByTestId('reserva-elegida').textContent).toContain('HM-001 · Ana Pérez')
    await waitFor(() => expect(screen.getByTestId('reserva-elegida').textContent).toContain('(en curso)'))
    fireEvent.click(screen.getByText('Actualizar'))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.updateCondominioRow.mock.calls[0][2]).not.toHaveProperty('estado')
    expect(mocks.updateCondominioRow.mock.calls[0][2]).toMatchObject({ reserva_str_id: 'r1', responsable_user_id: 'u2', notas: 'ojo' })
    fireEvent.click(screen.getByText('Cancelar servicio'))
    await waitFor(() => expect(mocks.updateCondominioRowAfectando).toHaveBeenCalledWith('servicios_housekeeping', 's1', { estado: 'cancelado' }))
    expect(onSaved).toHaveBeenCalled()
  })

  it('un servicio completado no ofrece «Cancelar servicio»', () => {
    abrir({ servicio: servicio({ estado: 'completado' }) })
    expect(screen.queryByText('Cancelar servicio')).toBeNull()
  })

  it('si la base rechaza la transición al cancelar lo explica', async () => {
    mocks.updateCondominioRowAfectando.mockResolvedValueOnce({ error: { message: 'HK_TRANSICION_INVALIDA: de "completado" a "cancelado"' } })
    abrir({ servicio: servicio({ estado: 'pendiente' }) })
    fireEvent.click(screen.getByText('Cancelar servicio'))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: expect.stringMatching(/Iniciar servicio/) })))
  })

  it('si el servidor niega el catálogo de reservas lo dice sin bloquear el alta', async () => {
    mocks.fetchReservasVinculables.mockResolvedValueOnce({ data: [], error: 'No autorizado' })
    abrir()
    expect((await screen.findByRole('alert')).textContent).toContain('No autorizado')
    await screen.findByTestId('responsable-elegido')
    fireEvent.click(screen.getByText('Agregar'))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
  })
})
