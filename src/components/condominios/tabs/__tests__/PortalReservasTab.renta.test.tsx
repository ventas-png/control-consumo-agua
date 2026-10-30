// Portal del residente (20261118000000): el equipo con renta dice su precio
// por unidad, lo pedido suma la renta al cobro de la reserva —aunque la
// amenidad no tenga tarifa— y hay que decir cómo se paga.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { Amenidad, PrestamoEquipo, ReservaAmenidad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  reservarAmenidad: vi.fn(async (..._args: unknown[]) => ({
    data: { id: 'r9', estado: 'confirmada', monto_tarifa: null, monto_renta_equipo: 100, metodo_pago_tarifa: 'pagar_momento', monto_total_cobro: 100, equipos_solicitados: 1 } as Record<string, unknown>,
    error: null as string | null,
  })),
  cancelarReservaAmenidad: vi.fn(async () => ({ data: { cuota_anulada: false }, error: null })),
  equiposDeAmenidad: vi.fn(async (..._args: unknown[]) => ({
    data: [
      { inventario_id: 'inv1', nombre: 'Sillas', categoria: 'mobiliario', unidad_medida: 'unidad', costo_reposicion: 120, costo_renta_unidad: 5, cantidad_max_por_reserva: 20, disponible: 25 },
      { inventario_id: 'inv2', nombre: 'Mesas', categoria: 'mobiliario', unidad_medida: 'unidad', costo_reposicion: 400, costo_renta_unidad: null, cantidad_max_por_reserva: null, disponible: 10 },
    ],
    error: null as string | null,
  })),
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
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

const como = <T,>(o: Record<string, unknown>) => ({ company_id: 'co1', project_id: 'p1', created_at: '2026-10-01T00:00:00Z', ...o }) as unknown as T

const amenidades: Amenidad[] = [
  como<Amenidad>({ id: 'am1', nombre: 'Salón', activo: true, requiere_deposito: false, requiere_tarifa: false, requiere_aprobacion: false, reglamento: null }),
]

function montar(extra: Partial<Parameters<typeof PortalReservasTab>[0]> = {}) {
  return render(
    <PortalReservasTab amenidades={amenidades} reservas={[]} bloqueos={[]} prestamos={[]} unidadId="u1" moneda="Q" onRefresh={() => {}} {...extra} />,
  )
}

async function abrirYElegir() {
  fireEvent.click(screen.getByRole('button', { name: '+ Nueva reserva' }))
  fireEvent.change(screen.getByLabelText('Amenidad *'), { target: { value: 'am1' } })
  fireEvent.change(screen.getByLabelText('Fecha *'), { target: { value: '2099-01-05' } })
  fireEvent.change(screen.getByLabelText('Hora inicio *'), { target: { value: '10:00' } })
  fireEvent.change(screen.getByLabelText('Hora fin *'), { target: { value: '12:00' } })
  await screen.findByText('Sillas')
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => cleanup())

describe('PortalReservasTab — renta del equipo', () => {
  it('el catálogo dice la renta por unidad, lo pedido la suma y pide cómo pagar aunque la amenidad no tenga tarifa', async () => {
    montar()
    await abrirYElegir()
    expect(screen.getByText(/25 disponibles · máx\. 20 por reserva · reposición Q 120\.00 c\/u/)).toBeTruthy()
    expect(screen.getByText(/renta Q 5\.00 c\/u/)).toBeTruthy()
    // Sin equipo pedido no hay cobro ni método de pago.
    expect(screen.queryByText(/¿Cómo deseas pagar/)).toBeNull()

    fireEvent.change(screen.getByLabelText('Cantidad de Mesas'), { target: { value: '2' } })
    expect(screen.queryByText(/¿Cómo deseas pagar/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Cantidad de Sillas'), { target: { value: '20' } })
    expect(screen.getByText('🪑 Renta del equipo pedido: Q 100.00')).toBeTruthy()
    expect(screen.getByText('Renta de equipo: Q 100.00')).toBeTruthy()
    expect(screen.getByText('¿Cómo deseas pagar la renta del equipo?')).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/Pagar al momento/))

    fireEvent.click(screen.getByRole('button', { name: '📅 Confirmar reserva' }))
    await waitFor(() => expect(mocks.reservarAmenidad).toHaveBeenCalledTimes(1))
    expect(mocks.reservarAmenidad).toHaveBeenCalledWith(expect.objectContaining({
      amenidadId: 'am1', metodoPago: 'pagar_momento',
      equipos: [{ inventario_id: 'inv2', cantidad: 2 }, { inventario_id: 'inv1', cantidad: 20 }],
    }))
    // El toast usa el total que devolvió el servidor y nombra la renta incluida.
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'success',
      title: 'Reserva confirmada. Pagar Q 100.00 en sitio.',
      text: expect.stringContaining('renta Q 100.00 incluida'),
    }))
  })

  it('mis reservas muestran el total con la renta incluida y cada línea de equipo su renta', () => {
    const reserva = como<ReservaAmenidad>({ id: 'r1', amenidad_id: 'am1', unidad_id: 'u1', fecha: '2099-01-05', hora_inicio: '10:00', hora_fin: '12:00', estado: 'confirmada', num_invitados: 0, deposito_pagado: false, tarifa_pagada: false, recordatorio_enviado: false, no_show: false, deposito_estado: 'no_aplica', monto_tarifa: 100, metodo_pago_tarifa: 'cargar_unidad' })
    const prestamo = como<PrestamoEquipo>({ id: 'pe1', unidad_id: 'u1', inventario_id: 'inv1', reserva_id: 'r1', equipo_nombre: 'Sillas', cantidad: 10, cantidad_solicitada: 10, fecha_prestamo: '2099-01-05', estado: 'solicitado', deposito_pagado: false, monto_renta: 50 })
    montar({ reservas: [reserva], prestamos: [prestamo] })
    expect(screen.getByText(/🎟 Q 150\.00 · incluye renta de equipo Q 50\.00 · cargado a tu unidad/)).toBeTruthy()
    expect(screen.getByText(/renta Q 50\.00/)).toBeTruthy()
  })
})
