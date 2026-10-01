// confirmarPago: lo que el portal le anuncia al residente sale de la respuesta
// de confirm-charge. Un cobro retenido (cuota anulada o eliminada,
// 20261015000000) no es un abono: el portal no debe decir que lo registró.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ respuesta: { data: null as unknown, error: null as unknown } }))
vi.mock('../../../lib/supabase', () => ({
  supabase: { functions: { invoke: vi.fn(async () => h.respuesta) } },
}))

import { confirmarPago, confirmarPagoCuota } from '../mutations'

beforeEach(() => { h.respuesta = { data: null, error: null } })

describe('confirmarPago', () => {
  it('conciliado: aprobado con lo que liquidó', async () => {
    h.respuesta = { data: { ok: true, estado: 'aprobado', conciliado: true, liquidado: false, saldo_restante: 12.5 }, error: null }
    expect(await confirmarPago('pr-1')).toEqual({ estado: 'aprobado', liquidado: false, saldoRestante: 12.5, error: null })
  })

  it('retenido por cuota anulada: «en_revision», nunca «aprobado» ni liquidado', async () => {
    h.respuesta = {
      data: { ok: true, estado: 'aprobado', conciliado: false, en_revision: true, estado_solicitud: 'pending_verification' },
      error: null,
    }
    expect(await confirmarPago('pr-2')).toEqual({ estado: 'en_revision', liquidado: false, saldoRestante: null, error: null })
    expect(await confirmarPagoCuota('pr-2')).toMatchObject({ estado: 'en_revision', cuotaLiquidada: false })
  })
})
