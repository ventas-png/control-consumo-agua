// E7 (20261018000000): cancelar la reserva anula su tarifa en el servidor; la
// pantalla sólo informa lo que pasó (supabase/tests/conta_ajustes §23).
import { describe, expect, it, vi } from 'vitest'

const sb = vi.hoisted(() => ({
  rpc: vi.fn((_n: string, _a: Record<string, unknown>) => ({
    abortSignal: async () => ({
      data: [{ reserva_id: 'rv1', tarifa: 'anulada', cuota_id: 'cu1', solicitud_id: 's1', detalle: null }], error: null,
    }),
  })),
}))
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: sb.rpc }, warmUpSupabase: vi.fn() }))

import { avisoCancelacionReserva, cancelarReservaConTarifa } from '../ajustes'

describe('cancelarReservaConTarifa', () => {
  it('una sola llamada al servidor: cancela y anula la tarifa juntas', async () => {
    const r = await cancelarReservaConTarifa('rv1', { motivo: ' salón ocupado ', rechazo: true })
    expect(r.tarifa).toBe('anulada')
    expect(sb.rpc).toHaveBeenCalledWith('conta_reserva_cancelar', { p_reserva_id: 'rv1', p_motivo: 'salón ocupado', p_rechazo: true })
  })
})

describe('avisoCancelacionReserva', () => {
  const base = { reserva_id: 'rv', cuota_id: 'cu', solicitud_id: null }
  it('anulada: éxito y lo dice', () => {
    expect(avisoCancelacionReserva({ ...base, tarifa: 'anulada', detalle: null })).toMatchObject({ variant: 'success', title: 'Reserva cancelada' })
  })
  it('con dependencias: aviso con el detalle, la tarifa sigue', () => {
    const a = avisoCancelacionReserva({ ...base, tarifa: 'requiere_solicitud', detalle: '• Cobro efectivo: Recházalo…' })
    expect(a.variant).toBe('warning')
    expect(a.text).toContain('Cobro efectivo')
  })
  it('fallida: aviso de reintento', () => {
    expect(avisoCancelacionReserva({ ...base, tarifa: 'fallida', detalle: 'AJUSTE_PERIODO_CERRADO: …' }).text).toContain('reintentar')
  })
})
