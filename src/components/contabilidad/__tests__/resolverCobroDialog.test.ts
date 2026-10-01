// El formulario de resolución manual de un cobro sin confirmar (E8): ofrece
// cobrado / no cobrado, exige motivo y no envía nada si se cancela.
import { describe, expect, it, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  dialogo: vi.fn(),
  solicitar: vi.fn(async () => ({ solicitud_id: 's1', estado: 'pendiente', repetida: false })),
}))
vi.mock('../../shared/PromptDialog', () => ({ openPromptDialog: h.dialogo }))
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: vi.fn() }, warmUpSupabase: vi.fn() }))
vi.mock('../../../domain/contabilidad/ajustes', async (orig) => ({
  ...(await orig<typeof import('../../../domain/contabilidad/ajustes')>()),
  solicitarResolucionCobro: h.solicitar,
}))

import { pedirResolucionCobro } from '../resolverCobroDialog'

beforeEach(() => { h.dialogo.mockReset(); h.solicitar.mockClear() })

describe('pedirResolucionCobro', () => {
  it('envía lo elegido con el motivo recortado', async () => {
    h.dialogo.mockResolvedValue({ resolucion: 'no_cobrado', motivo: '  el banco no lo cobró  ' })
    const r = await pedirResolucionCobro({ id: 'pr1', monto: 30 })
    const opts = h.dialogo.mock.calls[0][0]
    expect(opts.fields[0].options.map((o: { value: string }) => o.value)).toEqual(['cobrado', 'no_cobrado'])
    expect(r).toMatchObject({ solicitud_id: 's1' })
    expect(h.solicitar).toHaveBeenCalledWith(expect.objectContaining({
      paymentRequestId: 'pr1', resolucion: 'no_cobrado', motivo: 'el banco no lo cobró',
    }))
  })

  it('cancelar no envía; el motivo corto se rechaza', async () => {
    h.dialogo.mockResolvedValue(null)
    expect(await pedirResolucionCobro({ id: 'pr1', monto: null })).toBeNull()
    expect(h.dialogo.mock.calls[0][0].validate({ motivo: 'no' })).toMatch(/motivo/)
    expect(h.dialogo.mock.calls[0][0].validate({ motivo: 'motivo válido' })).toBeNull()
    expect(h.solicitar).not.toHaveBeenCalled()
  })
})
