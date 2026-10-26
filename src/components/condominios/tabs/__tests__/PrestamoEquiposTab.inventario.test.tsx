// Préstamo de equipos atado al inventario (20261108000000): el formulario
// elige una fila del inventario y no deja prestar más de lo disponible para
// la fecha; lo pedido con una reserva aparece como «Solicitado» con su reserva
// y se entrega o recibe por RPC (varias filas en una transacción, fecha y hora
// del servidor, reposición de lo que faltó).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { ItemInventario, PrestamoEquipo, ReservaAmenidad, Unidad } from '../../../../types'
import { hoyLocalISO } from '../../../../lib/format'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  deleteCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  entregarPrestamos: vi.fn(async (..._args: unknown[]) => ({ data: { entregados: 1, cancelados: 0 }, error: null })),
  recibirPrestamos: vi.fn(async (..._args: unknown[]) => ({ data: { recibidos: 1, monto_reposicion: 360, cuota_id: 'cu1' }, error: null })),
  openPromptDialog: vi.fn(async (..._args: unknown[]) => null as Record<string, string> | null),
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}), rpc: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../../domain/condominios/prestamosEquipo', () => ({
  entregarPrestamos: mocks.entregarPrestamos,
  recibirPrestamos: mocks.recibirPrestamos,
}))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify, confirm: mocks.confirm }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: mocks.openPromptDialog }))

const { PrestamoEquiposTab } = await import('../PrestamoEquiposTab')

const hoy = hoyLocalISO()

const como = <T,>(o: Record<string, unknown>) => ({ company_id: 'co1', project_id: 'p1', created_at: '2026-10-01T00:00:00Z', ...o }) as unknown as T

const inventario: ItemInventario[] = [
  como<ItemInventario>({ id: 'inv1', nombre: 'Sillas', categoria: 'mobiliario', estado: 'disponible', cantidad: 50, cantidad_minima: 0, unidad_medida: 'unidad', costo_unitario: 120 }),
  como<ItemInventario>({ id: 'inv2', nombre: 'Proyector', categoria: 'equipo', estado: 'disponible', cantidad: 1, cantidad_minima: 0, unidad_medida: 'unidad', costo_unitario: 2500 }),
]
const reservas: ReservaAmenidad[] = [
  como<ReservaAmenidad>({ id: 'r1', amenidad_id: 'am1', amenidad_nombre: 'Salón', unidad_id: 'un1', unidad_nombre: 'Casa 4', fecha: hoy, hora_inicio: '10:00', hora_fin: '12:00', estado: 'confirmada', num_invitados: 0, deposito_pagado: false, tarifa_pagada: false, recordatorio_enviado: false, no_show: false, deposito_estado: 'no_aplica' }),
]
const prestamos: PrestamoEquipo[] = [
  // En circulación: descuenta siempre.
  como<PrestamoEquipo>({ id: 'pe1', unidad_id: 'un1', unidad_nombre: 'Casa 4', inventario_id: 'inv1', equipo_nombre: 'Sillas', cantidad: 10, fecha_prestamo: '2026-09-01', estado: 'prestado', deposito_pagado: false, costo_reposicion_unitario: 120 }),
  // Pedido con la reserva de hoy: descuenta para hoy.
  como<PrestamoEquipo>({ id: 'pe2', unidad_id: 'un1', unidad_nombre: 'Casa 4', inventario_id: 'inv1', reserva_id: 'r1', equipo_nombre: 'Sillas', cantidad: 15, cantidad_solicitada: 15, fecha_prestamo: hoy, hora_prestamo: '10:00', estado: 'solicitado', deposito_pagado: false, costo_reposicion_unitario: 120 }),
  como<PrestamoEquipo>({ id: 'pe3', unidad_id: 'un1', unidad_nombre: 'Casa 4', inventario_id: 'inv2', reserva_id: 'r1', equipo_nombre: 'Proyector', cantidad: 1, cantidad_solicitada: 1, fecha_prestamo: hoy, estado: 'solicitado', deposito_pagado: false, costo_reposicion_unitario: 2500 }),
]
const unidades = [{ id: 'un1', nombre: 'Casa 4', activo: true }] as unknown as Unidad[]

function montar(extra: Partial<Parameters<typeof PrestamoEquiposTab>[0]> = {}) {
  return render(
    <PrestamoEquiposTab
      prestamos={prestamos} unidades={unidades} inventario={inventario} reservas={reservas} moneda="Q"
      proyectoId="p1" companyId="co1" canCreate canEdit canDelete onRefresh={() => {}} {...extra}
    />,
  )
}

/** Fila de la tabla cuyo texto contiene `texto`. */
function fila(texto: RegExp) {
  const celda = screen.getAllByRole('cell').find(c => texto.test(c.textContent ?? ''))!
  return celda.closest('tr') as HTMLElement
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => cleanup())

describe('PrestamoEquiposTab con inventario', () => {
  it('cuenta lo que está por entregar y muestra la reserva de la que cuelga cada préstamo', () => {
    montar()
    expect(screen.getByText('Por entregar').previousSibling?.textContent).toBe('2')
    expect(screen.getAllByText(/Reserva Salón/).length).toBe(2)
    // Dos chips en la tabla (el filtro «Solicitado» de arriba no cuenta).
    expect(within(screen.getByRole('table')).getAllByText('Solicitado').length).toBe(2)
  })

  it('el formulario toma el equipo del inventario y no deja prestar más de lo disponible para la fecha', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: '+ Registrar Préstamo' }))
    fireEvent.change(screen.getByLabelText('Unidad *'), { target: { value: 'un1' } })
    fireEvent.change(screen.getByLabelText('Equipo del inventario *'), { target: { value: 'inv1' } })
    // 50 en inventario − 10 prestadas − 15 solicitadas para hoy = 25.
    expect(screen.getByText(/25 de 50 disponible/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Cantidad'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning', title: 'Sin disponibilidad' })))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Cantidad'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow).toHaveBeenCalledWith('prestamos_equipo', expect.objectContaining({
      inventario_id: 'inv1', equipo_nombre: 'Sillas', cantidad: 20, cantidad_solicitada: 20, unidad_id: 'un1', estado: 'prestado',
    }))
  })

  it('sin inventario, el equipo se escribe libre como antes', async () => {
    montar({ inventario: [] })
    fireEvent.click(screen.getByRole('button', { name: '+ Registrar Préstamo' }))
    fireEvent.change(screen.getByLabelText('Unidad *'), { target: { value: 'un1' } })
    fireEvent.change(screen.getByLabelText('Equipo *'), { target: { value: 'Toldo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('prestamos_equipo', expect.objectContaining({ inventario_id: null, equipo_nombre: 'Toldo', cantidad: 1 })))
  })

  it('entregar un préstamo solicitado pasa por la RPC con la cantidad y quién entregó', async () => {
    mocks.openPromptDialog.mockResolvedValueOnce({ cantidad: '12', entregado_por: 'Luis', observaciones: 'una silla rota' })
    montar()
    const r = fila(/Proyector/)
    expect(within(r).queryByRole('button', { name: '✓ Recibir' })).toBeNull()
    fireEvent.click(within(fila(/Sillas.*Reserva Salón/)).getByRole('button', { name: '📦 Entregar' }))
    await waitFor(() => expect(mocks.entregarPrestamos).toHaveBeenCalledWith([{ id: 'pe2', cantidad: 12 }], 'Luis', 'una silla rota'))
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Entrega registrada' }))
  })

  it('recibir manda devueltos, estado, reposición y si se carga a la unidad', async () => {
    mocks.openPromptDialog.mockResolvedValueOnce({ cantidad_devuelta: '7', estado: 'perdido', monto_reposicion: '', observaciones: 'faltaron 3', recibido_por: 'Ana', generar_cargo: 'true' })
    montar()
    // La fila en circulación: su celda de equipo es sólo «Sillas» (sin reserva).
    const r = fila(/^Sillas$/)
    expect(within(r).queryByRole('button', { name: '📦 Entregar' })).toBeNull()
    fireEvent.click(within(r).getByRole('button', { name: '✓ Recibir' }))
    await waitFor(() => expect(mocks.recibirPrestamos).toHaveBeenCalledWith(
      [{ id: 'pe1', cantidad_devuelta: 7, estado: 'perdido', monto_reposicion: null, observaciones: 'faltaron 3' }], 'Ana', true,
    ))
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Recepción registrada', text: expect.stringContaining('Q 360.00') }))
  })

  it('un préstamo cerrado muestra devueltos, faltantes y reposición por cobrar', () => {
    montar({ prestamos: [
      como<PrestamoEquipo>({ id: 'pe9', unidad_id: 'un1', inventario_id: 'inv1', equipo_nombre: 'Sillas', cantidad: 10, cantidad_devuelta: 7, fecha_prestamo: '2026-09-01', fecha_devolucion: '2026-09-02', estado: 'perdido', deposito_pagado: false, monto_reposicion: 360 }),
    ] })
    const r = fila(/Sillas/)
    expect(r.textContent).toContain('7/10')
    expect(r.textContent).toContain('faltan 3')
    expect(r.textContent).toContain('Q 360.00')
    expect(screen.getByText('Reposición por cobrar').previousSibling?.textContent).toBe('Q 360.00')
    expect(within(r).queryByRole('button', { name: '✓ Recibir' })).toBeNull()
  })
})
