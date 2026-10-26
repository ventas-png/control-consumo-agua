// Portal del residente: al reservar elige qué equipo de la amenidad quiere que
// se le entregue (catálogo con disponibilidad por RPC, tope por reserva) y en
// sus reservas ve qué se le entregó, qué devolvió y qué debe por lo que faltó
// (20261108000000).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { Amenidad, PrestamoEquipo, ReservaAmenidad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  reservarAmenidad: vi.fn(async (..._args: unknown[]) => ({
    data: { id: 'r9', estado: 'confirmada', monto_tarifa: null, equipos_solicitados: 1 } as Record<string, unknown>,
    error: null as string | null,
  })),
  cancelarReservaAmenidad: vi.fn(async () => ({ data: { cuota_anulada: false }, error: null })),
  equiposDeAmenidad: vi.fn(async (..._args: unknown[]) => ({
    data: [{ inventario_id: 'inv1', nombre: 'Sillas', categoria: 'mobiliario', unidad_medida: 'unidad', costo_reposicion: 120, cantidad_max_por_reserva: 20, disponible: 25 }],
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

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => cleanup())

describe('PortalReservasTab — equipo de la reserva', () => {
  it('consulta el catálogo para la fecha, limita la cantidad al tope y lo manda con la reserva', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva reserva' }))
    fireEvent.change(screen.getByLabelText('Amenidad *'), { target: { value: 'am1' } })
    fireEvent.change(screen.getByLabelText('Fecha *'), { target: { value: '2099-01-05' } })
    fireEvent.change(screen.getByLabelText('Hora inicio *'), { target: { value: '10:00' } })
    fireEvent.change(screen.getByLabelText('Hora fin *'), { target: { value: '12:00' } })

    await screen.findByText('Sillas')
    await waitFor(() => expect(mocks.equiposDeAmenidad).toHaveBeenLastCalledWith('am1', '2099-01-05'))
    expect(screen.getByText(/25 disponibles · máx\. 20 por reserva · reposición Q 120\.00 c\/u/)).toBeTruthy()

    // 30 pedidas → se queda en el tope de 20 por reserva (y nunca por encima de lo disponible).
    const cantidad = screen.getByLabelText('Cantidad de Sillas') as HTMLInputElement
    fireEvent.change(cantidad, { target: { value: '30' } })
    expect(cantidad.value).toBe('20')
    expect(screen.getByText('1 equipo pedido con esta reserva')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '📅 Confirmar reserva' }))
    await waitFor(() => expect(mocks.reservarAmenidad).toHaveBeenCalledTimes(1))
    expect(mocks.reservarAmenidad).toHaveBeenCalledWith(expect.objectContaining({
      amenidadId: 'am1', unidadId: 'u1', fecha: '2099-01-05', equipos: [{ inventario_id: 'inv1', cantidad: 20 }],
    }))
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', text: expect.stringContaining('Equipo solicitado: 1') }))
  })

  it('sin fecha no deja pedir y al cambiar de amenidad se descarta lo pedido', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva reserva' }))
    fireEvent.change(screen.getByLabelText('Amenidad *'), { target: { value: 'am1' } })
    await screen.findByText('Sillas')
    expect((screen.getByLabelText('Cantidad de Sillas') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('Elige la fecha para ver cuánto hay disponible')).toBeTruthy()
  })

  it('cada reserva muestra su equipo: lo pedido, lo devuelto y la reposición cargada', () => {
    const reservas: ReservaAmenidad[] = [
      como<ReservaAmenidad>({ id: 'r1', amenidad_id: 'am1', unidad_id: 'u1', fecha: '2099-02-01', hora_inicio: '10:00', hora_fin: '12:00', estado: 'confirmada', num_invitados: 0, deposito_pagado: false, tarifa_pagada: false, recordatorio_enviado: false, no_show: false, deposito_estado: 'no_aplica' }),
    ]
    const prestamos: PrestamoEquipo[] = [
      como<PrestamoEquipo>({ id: 'pe1', reserva_id: 'r1', unidad_id: 'u1', inventario_id: 'inv1', equipo_nombre: 'Sillas', cantidad: 18, cantidad_solicitada: 20, fecha_prestamo: '2099-02-01', estado: 'solicitado', deposito_pagado: false }),
      como<PrestamoEquipo>({ id: 'pe2', reserva_id: 'r1', unidad_id: 'u1', inventario_id: 'inv2', equipo_nombre: 'Proyector', cantidad: 1, cantidad_devuelta: 0, fecha_prestamo: '2099-02-01', estado: 'perdido', deposito_pagado: false, monto_reposicion: 2500, cuota_reposicion_id: 'cu1' }),
      // Suelto (sin reserva) y en circulación: tiene su propio bloque.
      como<PrestamoEquipo>({ id: 'pe3', reserva_id: null, unidad_id: 'u1', inventario_id: 'inv3', equipo_nombre: 'Extensión', cantidad: 2, fecha_prestamo: '2026-10-01', estado: 'prestado', deposito_pagado: false }),
    ]
    montar({ reservas, prestamos })
    expect(screen.getByText('Sillas').parentElement?.textContent).toContain('×18 (pediste 20) · pendiente de entrega')
    expect(screen.getByText('Proyector').parentElement?.textContent).toContain('perdido · faltan 1 · reposición Q 2500.00 cargada a tu cuenta')
    expect(screen.getByText('🪑 Equipo prestado a tu unidad')).toBeTruthy()
    expect(screen.getByText('Extensión').parentElement?.textContent).toContain('entregado el 2026-10-01')
  })
})
