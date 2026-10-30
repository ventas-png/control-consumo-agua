// Amenidades con equipo del inventario (20261108000000): la amenidad enlaza
// qué equipo se presta con ella y hasta cuánto por reserva; la lista de
// reservas marca el equipo pendiente; el detalle registra la entrega por RPC.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { Amenidad, AmenidadInventario, ItemInventario, PrestamoEquipo, ReservaAmenidad, Unidad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  createCondominioRowReturning: vi.fn(async (..._args: unknown[]) => ({ data: { id: 'am-nueva' } as Record<string, unknown> | null, error: null as { message: string } | null })),
  updateCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  deleteCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  solicitarEquiposReserva: vi.fn(async (..._args: unknown[]) => ({ data: { equipos_solicitados: 1 }, error: null })),
  entregarPrestamos: vi.fn(async (..._args: unknown[]) => ({ data: { entregados: 1, cancelados: 0 }, error: null })),
  recibirPrestamos: vi.fn(async (..._args: unknown[]) => ({ data: { recibidos: 1, monto_reposicion: 0, cuota_id: null }, error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}), rpc: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  createCondominioRowReturning: mocks.createCondominioRowReturning,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../../domain/condominios/prestamosEquipo', () => ({
  solicitarEquiposReserva: mocks.solicitarEquiposReserva,
  entregarPrestamos: mocks.entregarPrestamos,
  recibirPrestamos: mocks.recibirPrestamos,
}))
vi.mock('../../../../domain/contabilidad/ajustes', () => ({
  solicitarAjuste: vi.fn(), cancelarReservaConTarifa: vi.fn(), avisoCancelacionReserva: vi.fn(() => ''),
}))
vi.mock('../../../../lib/storageUrls', () => ({ useSignedUrls: () => ({}), useSignedUrl: () => null }))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: vi.fn() }))

const { AmenidadesTab } = await import('../AmenidadesTab')

const como = <T,>(o: Record<string, unknown>) => ({ company_id: 'co1', project_id: 'p1', created_at: '2026-10-01T00:00:00Z', ...o }) as unknown as T

const unidades = [{ id: 'un1', nombre: 'Casa 4', activo: true }] as unknown as Unidad[]
const amenidad = como<Amenidad>({ id: 'am1', nombre: 'Salón', activo: true, requiere_deposito: false, requiere_tarifa: false, requiere_aprobacion: false, reglamento: null })
const inventario: ItemInventario[] = [
  como<ItemInventario>({ id: 'inv1', nombre: 'Sillas', categoria: 'mobiliario', estado: 'disponible', cantidad: 50, cantidad_minima: 0, unidad_medida: 'unidad', costo_unitario: 120 }),
  como<ItemInventario>({ id: 'inv2', nombre: 'Carpa', categoria: 'equipo', estado: 'dado_de_baja', cantidad: 1, cantidad_minima: 0, unidad_medida: 'unidad' }),
]
const links: AmenidadInventario[] = [como<AmenidadInventario>({ id: 'ai1', amenidad_id: 'am1', inventario_id: 'inv1', cantidad_max_por_reserva: 20 })]
const reserva = como<ReservaAmenidad>({ id: 'r1', amenidad_id: 'am1', amenidad_nombre: 'Salón', unidad_id: 'un1', unidad_nombre: 'Casa 4', fecha: '2099-01-05', hora_inicio: '10:00', hora_fin: '12:00', estado: 'confirmada', num_invitados: 0, deposito_pagado: false, tarifa_pagada: false, recordatorio_enviado: false, no_show: false, deposito_estado: 'no_aplica' })
const prestamos: PrestamoEquipo[] = [
  como<PrestamoEquipo>({ id: 'pe1', unidad_id: 'un1', inventario_id: 'inv1', reserva_id: 'r1', equipo_nombre: 'Sillas', cantidad: 20, cantidad_solicitada: 20, fecha_prestamo: '2099-01-05', estado: 'solicitado', deposito_pagado: false, costo_reposicion_unitario: 120 }),
]

function montar(extra: Partial<Parameters<typeof AmenidadesTab>[0]> = {}) {
  return render(
    <AmenidadesTab
      amenidades={[amenidad]} reservas={[reserva]} bloqueos={[]} unidades={unidades}
      inventario={inventario} prestamos={prestamos} amenidadInventario={links}
      proyectoId="p1" companyId="co1" userId="u1" moneda="Q" canCreate canEdit canDelete={false} onRefresh={() => {}} {...extra}
    />,
  )
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => cleanup())

describe('AmenidadesTab — equipo del inventario', () => {
  it('la tarjeta cuenta el equipo enlazado y al crear una amenidad se enlaza lo marcado con su tope', async () => {
    montar()
    expect(screen.getByText('🪑 1 equipo')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '+ Amenidad' }))
    // Lo dado de baja no se ofrece.
    expect(screen.queryByLabelText('Prestar Carpa con esta amenidad')).toBeNull()
    fireEvent.click(screen.getByLabelText('Prestar Sillas con esta amenidad'))
    fireEvent.change(screen.getByLabelText('Máx./reserva'), { target: { value: '10' } })
    fireEvent.change(screen.getByPlaceholderText('Ej. Piscina, Gimnasio, Salón Social'), { target: { value: 'Piscina' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.createCondominioRowReturning).toHaveBeenCalledWith('amenidades', expect.objectContaining({ nombre: 'Piscina' })))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('amenidad_inventario', [
      expect.objectContaining({ amenidad_id: 'am-nueva', inventario_id: 'inv1', cantidad_max_por_reserva: 10, company_id: 'co1', project_id: 'p1' }),
    ]))
  })

  it('editar una amenidad sincroniza los enlaces: cambia el tope y quita lo desmarcado', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: '✎ Editar' }))
    const check = screen.getByLabelText('Prestar Sillas con esta amenidad') as HTMLInputElement
    expect(check.checked).toBe(true)
    fireEvent.change(screen.getByLabelText('Máx./reserva'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('amenidad_inventario', 'ai1', { cantidad_max_por_reserva: 12 }))
    expect(mocks.deleteCondominioRow).not.toHaveBeenCalled()

    cleanup(); vi.clearAllMocks()
    montar()
    fireEvent.click(screen.getByRole('button', { name: '✎ Editar' }))
    fireEvent.click(screen.getByLabelText('Prestar Sillas con esta amenidad'))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(mocks.deleteCondominioRow).toHaveBeenCalledWith('amenidad_inventario', 'ai1'))
  })

  it('la lista marca el equipo por entregar y el detalle registra la entrega por RPC', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: '📋 Lista' }))
    expect(screen.getByText('🪑 1 equipo · por entregar')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '⋯ Detalle' }))
    expect(screen.getByText('Equipo por entregar')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '📦 Registrar entrega' }))
    const cantidad = screen.getByLabelText('Cantidad entregada de Sillas') as HTMLInputElement
    expect(cantidad.value).toBe('20')
    fireEvent.change(cantidad, { target: { value: '18' } })
    fireEvent.change(screen.getByLabelText('Entregado por'), { target: { value: 'Luis' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar entrega' }))
    await waitFor(() => expect(mocks.entregarPrestamos).toHaveBeenCalledWith([{ id: 'pe1', cantidad: 18 }], 'Luis', null))
  })

  it('desde el detalle se agrega equipo a la reserva respetando tope y disponibilidad', async () => {
    montar({ prestamos: [] })
    fireEvent.click(screen.getByRole('button', { name: '📋 Lista' }))
    fireEvent.click(screen.getByRole('button', { name: '⋯ Detalle' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar equipo' }))
    const input = screen.getByLabelText('Cantidad de Sillas') as HTMLInputElement
    // 50 disponibles pero el tope por reserva es 20.
    fireEvent.change(input, { target: { value: '35' } })
    expect(input.value).toBe('20')
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar equipo' }))
    // Sin renta no hay cargo que generar: el tercer argumento va en false.
    await waitFor(() => expect(mocks.solicitarEquiposReserva).toHaveBeenCalledWith('r1', [{ inventario_id: 'inv1', cantidad: 20 }], false))
  })

  it('la recepción manda devueltos, estado y reposición, y ofrece cargar a la unidad sólo si falta algo', async () => {
    montar({ prestamos: [como<PrestamoEquipo>({ ...prestamos[0], estado: 'prestado' })] })
    fireEvent.click(screen.getByRole('button', { name: '📋 Lista' }))
    expect(screen.getByText('🪑 1 equipo · por recibir')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '⋯ Detalle' }))
    fireEvent.click(screen.getByRole('button', { name: '↩ Registrar recepción' }))
    const modal = screen.getByText('↩ Recepción de equipo').parentElement as HTMLElement
    expect(within(modal).getByText('Sin faltantes ni daños')).toBeTruthy()
    fireEvent.change(within(modal).getByLabelText('Devueltos'), { target: { value: '17' } })
    // 3 faltantes × Q 120 congelados = Q 360, estado propuesto: perdido.
    expect(within(modal).getByText('Reposición: Q 360.00')).toBeTruthy()
    expect((within(modal).getByLabelText('Estado') as HTMLSelectElement).value).toBe('perdido')
    fireEvent.click(within(modal).getByLabelText(/Generar un cargo a la unidad/))
    fireEvent.change(within(modal).getByLabelText('Recibido por'), { target: { value: 'Ana' } })
    fireEvent.click(within(modal).getByRole('button', { name: 'Confirmar recepción' }))
    await waitFor(() => expect(mocks.recibirPrestamos).toHaveBeenCalledWith(
      [{ id: 'pe1', cantidad_devuelta: 17, estado: 'perdido', monto_reposicion: null, observaciones: null }], 'Ana', true,
    ))
  })
})
