// El formulario de rebaja: qué componentes ofrece y qué envía. No envía nada
// si se cancela; el motivo y el importe se validan antes de cerrar.
import { describe, expect, it, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  dialogo: vi.fn(),
  solicitar: vi.fn(async () => ({ solicitud_id: 's1', estado: 'pendiente', repetida: false })),
}))
vi.mock('../../shared/PromptDialog', () => ({ openPromptDialog: h.dialogo }))
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: vi.fn() }, warmUpSupabase: vi.fn() }))
vi.mock('../../../domain/contabilidad/ajustes', async (orig) => ({
  ...(await orig<typeof import('../../../domain/contabilidad/ajustes')>()),
  solicitarRebaja: h.solicitar,
}))

import { pedirRebaja } from '../solicitarRebajaDialog'

beforeEach(() => { h.dialogo.mockReset(); h.solicitar.mockClear() })

describe('pedirRebaja', () => {
  it('cuota con mora: ofrece principal y mora; envía lo elegido', async () => {
    h.dialogo.mockResolvedValue({ componente: 'mora', importe: '5', motivo: '  condonar mora  ' })
    const r = await pedirRebaja({ tabla: 'cuotas_condominio', id: 'cu1', concepto: 'Cuota X', tieneMora: true })
    const campos = h.dialogo.mock.calls[0][0].fields
    expect(campos[0].options.map((o: { value: string }) => o.value)).toEqual(['principal', 'mora'])
    expect(r).toMatchObject({ solicitud_id: 's1' })
    expect(h.solicitar).toHaveBeenCalledWith(expect.objectContaining({
      documentoTabla: 'cuotas_condominio', documentoId: 'cu1', componente: 'mora', importe: 5, motivo: 'condonar mora',
    }))
  })

  it('cargo: sólo «cargo»; la validación rechaza un aumento y un motivo corto', async () => {
    h.dialogo.mockResolvedValue(null)
    await pedirRebaja({ tabla: 'cargos_adicionales_unidad', id: 'ca1', concepto: 'Cargo Y' })
    const opts = h.dialogo.mock.calls[0][0]
    expect(opts.fields[0].options.map((o: { value: string }) => o.value)).toEqual(['cargo'])
    expect(opts.validate({ importe: '-3', motivo: 'motivo largo' })).toMatch(/positivo/)
    expect(opts.validate({ importe: '3', motivo: 'no' })).toMatch(/motivo/)
    expect(opts.validate({ importe: '3', motivo: 'motivo válido' })).toBeNull()
    expect(h.solicitar).not.toHaveBeenCalled()
  })
})
