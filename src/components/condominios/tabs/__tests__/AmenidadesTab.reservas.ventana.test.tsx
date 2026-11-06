// Reservas (vista Lista de Amenidades): la tarjeta abre la ficha en ventana (EditModal real, pantalla completa en el
// teléfono) con los datos en tarjetas, el seguimiento y las acciones en el pie junto a Cerrar; el alta también va en
// ventana y la reserva del calendario semanal abre la misma ficha. Antes cada tarjeta traía sus botones en fila y el
// detalle era un panel propio sin Escape.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { Amenidad, ReservaAmenidad, Unidad } from '../../../../types'
import { hoyLocalISO } from '../../../../lib/format'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  createCondominioRowReturning: vi.fn(async (..._args: unknown[]) => ({ data: { id: 'nuevo' } as Record<string, unknown> | null, error: null as { message: string } | null })),
  updateCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  deleteCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
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
  solicitarEquiposReserva: vi.fn(), entregarPrestamos: vi.fn(), recibirPrestamos: vi.fn(),
}))
vi.mock('../../../../domain/contabilidad/ajustes', () => ({
  solicitarAjuste: vi.fn(), cancelarReservaConTarifa: vi.fn(), avisoCancelacionReserva: vi.fn(() => ''),
}))
vi.mock('../../../../lib/storageUrls', () => ({ useSignedUrls: () => ({}), useSignedUrl: () => null }))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: vi.fn() }))

const { AmenidadesTab } = await import('../AmenidadesTab')

const como = <T,>(o: Record<string, unknown>) => ({ company_id: 'co1', project_id: 'p1', created_at: '2026-10-01T09:30:00Z', ...o }) as unknown as T
const unidades = [{ id: 'un1', nombre: 'Casa 4', activo: true }] as unknown as Unidad[]
const salon = como<Amenidad>({ id: 'am1', nombre: 'Salón', activo: true, requiere_deposito: false, requiere_tarifa: false, requiere_aprobacion: true, reglamento: null })
const reserva = (o: Record<string, unknown>) => como<ReservaAmenidad>({
  amenidad_id: 'am1', amenidad_nombre: 'Salón', unidad_id: 'un1', unidad_nombre: 'Casa 4', hora_inicio: '10:00', hora_fin: '12:00',
  estado: 'confirmada', num_invitados: 12, deposito_pagado: false, tarifa_pagada: false, recordatorio_enviado: false, no_show: false,
  deposito_estado: 'no_aplica', monto_tarifa: null, metodo_pago_tarifa: 'cargar_unidad', ...o,
})
const confirmada = reserva({ id: 'r1', fecha: '2099-01-05', aprobada_at: '2026-10-02T10:00:00Z', notas: 'Piden acceso desde las 9:00 para decorar.' })
const pendiente = reserva({ id: 'r2', fecha: '2099-02-10', estado: 'pendiente', num_invitados: 0 })
const deHoy = reserva({ id: 'r3', fecha: hoyLocalISO(), hora_inicio: '16:00', hora_fin: '18:00' })

function montar(extra: Partial<Parameters<typeof AmenidadesTab>[0]> = {}) {
  return render(
    <AmenidadesTab amenidades={[salon]} reservas={[confirmada, pendiente, deHoy]} bloqueos={[]} unidades={unidades}
      proyectoId="p1" companyId="co1" userId="u1" moneda="Q" canCreate canEdit canDelete={false} onRefresh={() => {}} {...extra} />,
  )
}
const lista = () => fireEvent.click(screen.getByRole('button', { name: '📋 Lista' }))
const tarjeta = (nombre: string) => screen.getByRole('button', { name: nombre })
const ficha = () => screen.getByRole('dialog', { name: 'Salón' })
const pie = () => ficha().querySelector('.at-modal-footer') as HTMLElement

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => cleanup())

describe('Reservas — la ficha abre en ventana', () => {
  it('la tarjeta abre la ficha (pantalla completa en el teléfono) con tarjetas de datos, notas y seguimiento; Cerrar y Escape la cierran', () => {
    montar()
    lista()
    expect(screen.queryByRole('dialog')).toBeNull()
    // Las acciones ya no van en la tarjeta.
    expect(screen.queryByRole('button', { name: '⋯ Detalle' })).toBeNull()
    expect(screen.queryByRole('button', { name: '✓ Aprobar' })).toBeNull()

    fireEvent.click(tarjeta('Reserva de Salón · Casa 4 · 2099-01-05'))
    const v = ficha()
    expect(v.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(v).getByText('Unidad').nextSibling?.textContent).toBe('Casa 4')
    expect(within(v).getByText('Horario').nextSibling?.textContent).toBe('10:00–12:00')
    expect(within(v).getByText('Invitados').nextSibling?.textContent).toBe('12')
    expect(within(v).getByText('Piden acceso desde las 9:00 para decorar.')).toBeTruthy()
    expect(within(v).getByText('Seguimiento')).toBeTruthy()
    expect(within(v).getByText('Aprobada')).toBeTruthy()
    expect(within(v).getByText('Check-in')).toBeTruthy()
    expect(within(pie()).getAllByRole('button').map(b => b.textContent)).toEqual(['Cerrar', '✕ Cancelar reserva'])

    fireEvent.click(within(pie()).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(tarjeta('Reserva de Salón · Casa 4 · 2099-01-05'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('una reserva pendiente ofrece Rechazar y Aprobar en el pie; Aprobar confirma la reserva', async () => {
    montar()
    lista()
    fireEvent.click(tarjeta('Reserva de Salón · Casa 4 · 2099-02-10'))
    expect(within(pie()).getAllByRole('button').map(b => b.textContent)).toEqual(['Cerrar', '✕ Cancelar reserva', '✗ Rechazar', '✓ Aprobar'])
    expect(within(ficha()).getByText('En aprobación')).toBeTruthy()
    fireEvent.click(within(pie()).getByRole('button', { name: '✓ Aprobar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('reservas_amenidades', 'r2', expect.objectContaining({ estado: 'confirmada' })))
  })

  it('sin permiso de editar el pie sólo tiene Cerrar', () => {
    montar({ canEdit: false })
    lista()
    fireEvent.click(tarjeta('Reserva de Salón · Casa 4 · 2099-02-10'))
    expect(within(pie()).getAllByRole('button').map(b => b.textContent)).toEqual(['Cerrar'])
  })

  it('«+ Reserva» abre el alta en ventana y Cancelar la cierra; la reserva del calendario semanal abre la misma ficha', () => {
    const { container } = montar()
    lista()
    fireEvent.click(screen.getByRole('button', { name: '+ Reserva' }))
    const alta = screen.getByRole('dialog', { name: 'Nueva reserva' })
    expect(alta.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(alta).getByLabelText('Amenidad *')).toBeTruthy()
    expect(within(alta).getByRole('button', { name: 'Confirmar reserva' })).toBeTruthy()
    fireEvent.click(within(alta).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '📆 Calendario' }))
    const bloque = container.querySelector('[data-role="reserva"]') as HTMLElement
    expect(bloque).toBeTruthy()
    fireEvent.click(bloque)
    expect(within(ficha()).getByText('Horario').nextSibling?.textContent).toBe('16:00–18:00')
  })
})
