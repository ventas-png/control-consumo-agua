// Portal del residente · Reservas: la fila de "Mis reservas" abre la ficha en ventana emergente
// (EditModal real, pantalla completa en el teléfono) con el cobro desglosado, el equipo pedido, las
// notas y el botón Cancelar reserva en el pie. Antes todo iba apretado en la fila, con el botón al
// lado del estado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { Amenidad, PrestamoEquipo, ReservaAmenidad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  reservarAmenidad: vi.fn(async () => ({ data: null, error: 'no se usa' })),
  cancelarReservaAmenidad: vi.fn(async (..._args: unknown[]) => ({ data: { cuota_anulada: false }, error: null as string | null })),
  equiposDeAmenidad: vi.fn(async () => ({ data: [], error: null })),
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  onRefresh: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}), rpc: () => ({}) } }))
vi.mock('../../../../lib/storageUrls', () => ({ useSignedUrl: () => null, useSignedUrls: () => [] }))
vi.mock('../../../../domain/portal/reservas', () => ({
  reservarAmenidad: mocks.reservarAmenidad,
  cancelarReservaAmenidad: mocks.cancelarReservaAmenidad,
  equiposDeAmenidad: mocks.equiposDeAmenidad,
}))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify, confirm: mocks.confirm }))

const { PortalReservasTab } = await import('../PortalReservasTab')

const como = <T,>(o: Record<string, unknown>) => ({ company_id: 'co1', project_id: 'p1', created_at: '2026-10-01T15:30:00Z', ...o }) as unknown as T
const reserva = (o: Record<string, unknown>) => como<ReservaAmenidad>({
  unidad_id: 'u1', hora_inicio: '10:00', hora_fin: '12:00', estado: 'confirmada', num_invitados: 0, deposito_pagado: false,
  tarifa_pagada: false, recordatorio_enviado: false, no_show: false, deposito_estado: 'no_aplica', ...o,
})

const amenidades: Amenidad[] = [
  como<Amenidad>({ id: 'am1', nombre: 'Salón', activo: true, requiere_deposito: true, monto_deposito: 500, requiere_tarifa: true, tarifa_uso: 100, requiere_aprobacion: false, reglamento: null }),
  como<Amenidad>({ id: 'am2', nombre: 'Piscina', activo: true, requiere_deposito: false, requiere_tarifa: false, requiere_aprobacion: true, reglamento: null }),
]
const SALON = reserva({ id: 'r1', amenidad_id: 'am1', fecha: '2099-01-05', num_invitados: 12, monto_tarifa: 100, metodo_pago_tarifa: 'cargar_unidad', deposito_estado: 'cobrado', notas: 'Cumpleaños de Ana.' })
const PISCINA = reserva({ id: 'r2', amenidad_id: 'am2', fecha: '2099-02-10', hora_inicio: '15:00', hora_fin: '17:00', estado: 'pendiente' })
const RECHAZADA = reserva({ id: 'r3', amenidad_id: 'am2', fecha: '2099-03-01', estado: 'cancelada', rechazada_motivo: 'Fecha ocupada por mantenimiento.' })
const PASADA = reserva({ id: 'r4', amenidad_id: 'am1', fecha: '2020-01-01' })
const SILLAS = como<PrestamoEquipo>({ id: 'pe1', unidad_id: 'u1', inventario_id: 'inv1', reserva_id: 'r1', equipo_nombre: 'Sillas', cantidad: 10, cantidad_solicitada: 10, fecha_prestamo: '2099-01-05', estado: 'solicitado', deposito_pagado: false, monto_renta: 50 })

function montar() {
  return render(<PortalReservasTab amenidades={amenidades} reservas={[SALON, PISCINA, RECHAZADA, PASADA]} bloqueos={[]} prestamos={[SILLAS]} unidadId="u1" moneda="Q" onRefresh={mocks.onRefresh} />)
}
const abrir = (nombre: string) => fireEvent.click(screen.getByRole('button', { name: nombre }))
const ficha = (titulo: string) => screen.getByRole('dialog', { name: titulo })
const botonesPie = (titulo: string) => within(ficha(titulo).querySelector('.at-modal-footer') as HTMLElement).getAllByRole('button').map(b => b.textContent)

beforeEach(() => { vi.clearAllMocks(); mocks.confirm.mockResolvedValue({ isConfirmed: true }) })
afterEach(cleanup)

describe('PortalReservasTab — la fila abre la ficha en ventana', () => {
  it('sin pulsar nada sólo hay filas; la fila abre la ficha a pantalla completa en el teléfono con cobro, equipo y notas', () => {
    montar()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reserva de Salón · 2099-01-05' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reserva de Piscina · 2099-02-10' })).toBeTruthy()
    // La fila resume: cobro y cuántos equipos, sin el desglose ni el botón Cancelar.
    expect(screen.getByText('🎟 Q 150.00')).toBeTruthy()
    expect(screen.getByText('🪑 1 equipo')).toBeTruthy()
    expect(screen.queryByText('Cumpleaños de Ana.')).toBeNull()
    expect(screen.queryByText('Sillas')).toBeNull()
    expect(screen.queryByRole('button', { name: /Cancelar/ })).toBeNull()

    abrir('Reserva de Salón · 2099-01-05')
    const v = ficha('Salón')
    expect(v.classList.contains('at-modal--fs-mobile')).toBe(true)
    // Estado: chip del subtítulo + tarjeta de datos.
    expect(within(v).getAllByText('Confirmada')).toHaveLength(2)
    expect(within(v).getByText(/de enero de 2099$/)).toBeTruthy()
    expect(within(v).getByText('10:00 – 12:00')).toBeTruthy()
    expect(within(v).getByText('12')).toBeTruthy()
    expect(within(v).getByText('Q 100.00')).toBeTruthy()
    expect(within(v).getByText('Q 50.00')).toBeTruthy()
    expect(within(v).getByText('Q 150.00 · cargado a tu unidad')).toBeTruthy()
    expect(within(v).getByText('Q 500.00 · cobrado')).toBeTruthy()
    expect(within(v).getByText('Cumpleaños de Ana.')).toBeTruthy()
    expect(within(v).getByText('Equipo pedido con la reserva')).toBeTruthy()
    expect(within(v).getByText('Sillas').parentElement?.textContent).toContain('×10 · pendiente de entrega · renta Q 50.00')
    expect(botonesPie('Salón')).toEqual(['Cerrar', '✕ Cancelar reserva'])
  })

  it('Cerrar, Escape y Enter; la pendiente avisa que falta aprobación; en el historial sólo queda Cerrar y la rechazada dice por qué', () => {
    montar()
    abrir('Reserva de Salón · 2099-01-05')
    fireEvent.click(within(ficha('Salón')).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reserva de Salón · 2099-01-05' }), { key: 'Enter' })
    expect(ficha('Salón')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    abrir('Reserva de Piscina · 2099-02-10')
    expect(within(ficha('Piscina')).getByText('⏳ La administración aún debe aprobar esta reserva.')).toBeTruthy()
    expect(botonesPie('Piscina')).toEqual(['Cerrar', '✕ Cancelar reserva'])
    fireEvent.keyDown(document, { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: '📋 Historial (2)' }))
    abrir('Reserva de Piscina · 2099-03-01')
    expect(within(ficha('Piscina')).getByText('↩ Rechazada: Fecha ocupada por mantenimiento.')).toBeTruthy()
    expect(botonesPie('Piscina')).toEqual(['Cerrar'])
    fireEvent.keyDown(document, { key: 'Escape' })
    abrir('Reserva de Salón · 2020-01-01')
    expect(botonesPie('Salón')).toEqual(['Cerrar'])
  })

  it('Cancelar reserva confirma primero; al confirmar cancela, avisa, cierra la ficha y refresca; si no, no toca nada; si falla, avisa y la ficha sigue', async () => {
    montar()
    abrir('Reserva de Salón · 2099-01-05')
    fireEvent.click(within(ficha('Salón')).getByRole('button', { name: '✕ Cancelar reserva' }))
    await waitFor(() => expect(mocks.cancelarReservaAmenidad).toHaveBeenCalledWith('r1'))
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '¿Cancelar reserva?' }))
    await waitFor(() => expect(mocks.onRefresh).toHaveBeenCalledTimes(1))
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Reserva cancelada' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    mocks.confirm.mockResolvedValueOnce({ isConfirmed: false })
    abrir('Reserva de Piscina · 2099-02-10')
    fireEvent.click(within(ficha('Piscina')).getByRole('button', { name: '✕ Cancelar reserva' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2))
    expect(mocks.cancelarReservaAmenidad).toHaveBeenCalledTimes(1)
    expect(ficha('Piscina')).toBeTruthy()

    mocks.cancelarReservaAmenidad.mockResolvedValueOnce({ data: null as never, error: 'Ya empezó' })
    fireEvent.click(within(ficha('Piscina')).getByRole('button', { name: '✕ Cancelar reserva' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Ya empezó' })))
    expect(mocks.onRefresh).toHaveBeenCalledTimes(1)
    expect(ficha('Piscina')).toBeTruthy()
  })
})
