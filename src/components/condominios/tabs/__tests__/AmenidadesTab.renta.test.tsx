// Amenidades (20261118000000): crear y editar van en ventana, y el equipo que
// el inventario marca «se presta a un costo» suma su renta al cobro de la
// reserva — en el formulario del panel, al confirmar (cuota = tarifa + renta)
// y al agregar equipo desde el detalle (cargo aparte, opcional).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { Amenidad, AmenidadInventario, ItemInventario, PrestamoEquipo, ReservaAmenidad, Unidad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  createCondominioRowReturning: vi.fn(async (..._args: unknown[]) => ({ data: { id: 'nuevo' } as Record<string, unknown> | null, error: null as { message: string } | null })),
  updateCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  deleteCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  solicitarEquiposReserva: vi.fn(async (..._args: unknown[]) => ({ data: { equipos_solicitados: 1, monto_renta: 20, cuota_id: 'cu-renta' }, error: null })),
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
const salon = como<Amenidad>({ id: 'am1', nombre: 'Salón', activo: true, requiere_deposito: false, requiere_tarifa: false, requiere_aprobacion: false, reglamento: null })
const terraza = como<Amenidad>({ id: 'am2', nombre: 'Terraza', activo: true, requiere_deposito: false, requiere_tarifa: true, tarifa_uso: 100, requiere_aprobacion: false, reglamento: null })
const inventario: ItemInventario[] = [
  como<ItemInventario>({ id: 'inv1', nombre: 'Sillas', categoria: 'mobiliario', estado: 'disponible', cantidad: 50, cantidad_minima: 0, unidad_medida: 'unidad', costo_unitario: 120, prestable_con_costo: true, costo_renta_unidad: 5 }),
  como<ItemInventario>({ id: 'inv2', nombre: 'Mesas', categoria: 'mobiliario', estado: 'disponible', cantidad: 10, cantidad_minima: 0, unidad_medida: 'unidad', costo_unitario: 400, prestable_con_costo: false, costo_renta_unidad: null }),
]
const links: AmenidadInventario[] = [
  como<AmenidadInventario>({ id: 'ai1', amenidad_id: 'am1', inventario_id: 'inv1', cantidad_max_por_reserva: 20 }),
  como<AmenidadInventario>({ id: 'ai2', amenidad_id: 'am1', inventario_id: 'inv2', cantidad_max_por_reserva: null }),
  como<AmenidadInventario>({ id: 'ai3', amenidad_id: 'am2', inventario_id: 'inv1', cantidad_max_por_reserva: null }),
]
const reserva = como<ReservaAmenidad>({ id: 'r1', amenidad_id: 'am1', amenidad_nombre: 'Salón', unidad_id: 'un1', unidad_nombre: 'Casa 4', fecha: '2099-01-05', hora_inicio: '10:00', hora_fin: '12:00', estado: 'confirmada', num_invitados: 0, deposito_pagado: false, tarifa_pagada: false, recordatorio_enviado: false, no_show: false, deposito_estado: 'no_aplica', monto_tarifa: null, metodo_pago_tarifa: 'cargar_unidad' })
// La renta de la reserva vive en sus líneas de préstamo (congelada por la base): 10 sillas × Q 5.
const lineaRenta = como<PrestamoEquipo>({ id: 'pe1', unidad_id: 'un1', inventario_id: 'inv1', reserva_id: 'r1', equipo_nombre: 'Sillas', cantidad: 10, cantidad_solicitada: 10, fecha_prestamo: '2099-01-05', estado: 'devuelto', cantidad_devuelta: 10, deposito_pagado: false, costo_renta_unitario: 5, monto_renta: 50, cuota_renta_id: 'cu1' })

function montar(extra: Partial<Parameters<typeof AmenidadesTab>[0]> = {}) {
  return render(
    <AmenidadesTab
      amenidades={[salon, terraza]} reservas={[reserva]} bloqueos={[]} unidades={unidades}
      inventario={inventario} prestamos={[lineaRenta]} amenidadInventario={links}
      proyectoId="p1" companyId="co1" userId="u1" moneda="Q" canCreate canEdit canDelete={false} onRefresh={() => {}} {...extra}
    />,
  )
}

function llenarReserva(amenidadId: string, fecha: string) {
  fireEvent.click(screen.getByRole('button', { name: '📋 Lista' }))
  fireEvent.click(screen.getByRole('button', { name: '+ Reserva' }))
  fireEvent.change(screen.getByLabelText('Amenidad *'), { target: { value: amenidadId } })
  fireEvent.change(screen.getByLabelText('Unidad *'), { target: { value: 'un1' } })
  fireEvent.change(screen.getByLabelText('Fecha *'), { target: { value: fecha } })
  fireEvent.change(screen.getByLabelText('Hora inicio *'), { target: { value: '15:00' } })
  fireEvent.change(screen.getByLabelText('Hora fin *'), { target: { value: '17:00' } })
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => cleanup())

describe('AmenidadesTab — crear y editar en ventana', () => {
  it('«+ Amenidad» abre la ventana (pantalla completa en el teléfono), Escape la cierra y guarda desde el pie', async () => {
    montar()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '+ Amenidad' }))
    const dialog = screen.getByRole('dialog', { name: 'Nueva amenidad' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    // El selector de equipo dice a cuánto se renta lo marcado en Inventario.
    expect(within(dialog).getByText(/se renta a 5\.00 c\/u/)).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+ Amenidad' }))
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Nombre *'), { target: { value: 'Gimnasio' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.createCondominioRowReturning).toHaveBeenCalledWith('amenidades', expect.objectContaining({ nombre: 'Gimnasio' })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('«✎ Editar» abre la misma ventana con los datos de la amenidad y «Cancelar» la cierra sin guardar', () => {
    montar()
    fireEvent.click(screen.getAllByRole('button', { name: '✎ Editar' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Editar amenidad' })
    expect((within(dialog).getByLabelText('Nombre *') as HTMLInputElement).value).toBe('Salón')
    expect((within(dialog).getByLabelText('Prestar Sillas con esta amenidad') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })
})

describe('AmenidadesTab — la renta del equipo se suma a la reserva', () => {
  it('sin tarifa: pedir 10 sillas a Q 5 muestra la renta, pide el método de pago y carga Q 50 a la unidad', async () => {
    montar()
    llenarReserva('am1', '2099-01-06')
    // Antes de pedir equipo no hay nada que cobrar.
    expect(screen.queryByText(/Renta de equipo/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Cantidad de Sillas'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Cantidad de Mesas'), { target: { value: '2' } })
    expect(screen.getByText(/renta Q 5\.00 c\/u/)).toBeTruthy()
    expect(screen.getByText('🪑 Renta de equipo (adicional a la reserva)')).toBeTruthy()
    expect(screen.getByText('🪑 Renta de equipo: Q 50.00')).toBeTruthy()
    expect((screen.getByLabelText('Cargar a la unidad') as HTMLInputElement).checked).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reserva' }))
    await waitFor(() => expect(mocks.createCondominioRowReturning).toHaveBeenCalledWith('reservas_amenidades', expect.objectContaining({
      amenidad_id: 'am1', unidad_id: 'un1', monto_tarifa: null, metodo_pago_tarifa: 'cargar_unidad', cuota_id: 'nuevo',
    })))
    // La renta no se guarda en la reserva: la base la congela en cada línea de equipo.
    expect(mocks.createCondominioRowReturning).not.toHaveBeenCalledWith('reservas_amenidades', expect.objectContaining({ monto_renta_equipo: expect.anything() }))
    expect(mocks.createCondominioRowReturning).toHaveBeenCalledWith('cuotas_condominio', expect.objectContaining({
      unidad_id: 'un1', concepto: 'amenidad', monto: 50, notas: expect.stringContaining('incluye renta de equipo 50.00'),
    }))
    await waitFor(() => expect(mocks.solicitarEquiposReserva).toHaveBeenCalledWith('nuevo', [{ inventario_id: 'inv1', cantidad: 10 }, { inventario_id: 'inv2', cantidad: 2 }]))
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Reserva confirmada. Se cargó Q 50.00 a la unidad (renta de equipo).' }))
  })

  it('con tarifa: la cuota lleva tarifa + renta y el resumen muestra el total', async () => {
    montar()
    llenarReserva('am2', '2099-01-07')
    expect(screen.getByText(/Tarifa por uso: Q 100\.00/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Cantidad de Sillas'), { target: { value: '4' } })
    expect(screen.getByText('🪑 Renta de equipo: Q 20.00')).toBeTruthy()
    expect(screen.getByText('Total a cobrar: Q 120.00')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Pagar en sitio'))

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reserva' }))
    await waitFor(() => expect(mocks.createCondominioRowReturning).toHaveBeenCalledWith('reservas_amenidades', expect.objectContaining({
      monto_tarifa: 100, metodo_pago_tarifa: 'pagar_momento', cuota_id: null, tarifa_pagada: false,
    })))
    // Pagar en sitio: no se genera cuota.
    expect(mocks.createCondominioRowReturning).not.toHaveBeenCalledWith('cuotas_condominio', expect.anything())
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Reserva confirmada. Cobrar Q 120.00 en sitio (tarifa 100.00 + renta de equipo 20.00).' }))
  })

  it('la lista y el detalle suman la renta desde las líneas de equipo de la reserva', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: '📋 Lista' }))
    expect(screen.getByText(/🎟 Q 50\.00 · incl\. renta Q 50\.00 · unidad/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '⋯ Detalle' }))
    expect(screen.getByText('Renta de equipo:')).toBeTruthy()
    expect(screen.getByText(/cargado a unidad/)).toBeTruthy()
    expect(screen.getByText(/renta Q 50\.00 \(cargo generado\)/)).toBeTruthy()
    expect(screen.getByText(/Renta de equipo: Q 50\.00/)).toBeTruthy()
  })

  it('al agregar equipo con renta desde el detalle se propone cargarla a la unidad y se manda al RPC', async () => {
    montar({ prestamos: [] })
    fireEvent.click(screen.getByRole('button', { name: '📋 Lista' }))
    fireEvent.click(screen.getByRole('button', { name: '⋯ Detalle' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar equipo' }))
    expect(screen.queryByLabelText(/Generar un cargo a la unidad por la renta/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Cantidad de Sillas'), { target: { value: '4' } })
    const cargo = screen.getByLabelText(/Generar un cargo a la unidad por la renta \(Q 20\.00\)/) as HTMLInputElement
    expect(cargo.checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar equipo' }))
    await waitFor(() => expect(mocks.solicitarEquiposReserva).toHaveBeenCalledWith('r1', [{ inventario_id: 'inv1', cantidad: 4 }], true))
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', text: 'Renta Q 20.00 · se generó el cargo a la unidad' }))

    cleanup(); vi.clearAllMocks()
    montar({ prestamos: [] })
    fireEvent.click(screen.getByRole('button', { name: '📋 Lista' }))
    fireEvent.click(screen.getByRole('button', { name: '⋯ Detalle' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar equipo' }))
    fireEvent.change(screen.getByLabelText('Cantidad de Mesas'), { target: { value: '2' } })
    // Las mesas se prestan sin costo: no hay cargo que ofrecer.
    expect(screen.queryByLabelText(/Generar un cargo a la unidad por la renta/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Cantidad de Sillas'), { target: { value: '4' } })
    fireEvent.click(screen.getByLabelText(/Generar un cargo a la unidad por la renta/))
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar equipo' }))
    await waitFor(() => expect(mocks.solicitarEquiposReserva).toHaveBeenCalledWith('r1', [{ inventario_id: 'inv2', cantidad: 2 }, { inventario_id: 'inv1', cantidad: 4 }], false))
  })
})
