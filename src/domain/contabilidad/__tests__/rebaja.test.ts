// E6 (20261017000000): rebaja de importe. Sólo rebajas con dos decimales; el
// tope lo aplica el servidor (supabase/tests/conta_ajustes §22).
import { describe, expect, it, vi } from 'vitest'

const sb = vi.hoisted(() => ({
  rpc: vi.fn((_n: string, _a: Record<string, unknown>) => ({
    abortSignal: async () => ({ data: [{ solicitud_id: 's1', estado: 'pendiente', repetida: false }], error: null }),
  })),
}))
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: sb.rpc }, warmUpSupabase: vi.fn() }))

import { leerImporteRebaja, solicitarRebaja, ETIQUETA_TIPO_AJUSTE } from '../ajustes'

describe('leerImporteRebaja', () => {
  it('acepta importes positivos con hasta dos decimales (coma o punto)', () => {
    expect(leerImporteRebaja('30')).toEqual({ importe: 30 })
    expect(leerImporteRebaja(' 12,5 ')).toEqual({ importe: 12.5 })
    expect(leerImporteRebaja('0.01')).toEqual({ importe: 0.01 })
  })
  it('rechaza aumentos, cero, más de dos decimales y texto', () => {
    for (const t of ['-10', '0', '0.00', '1.234', 'abc', '', '1e3']) {
      expect('error' in leerImporteRebaja(t)).toBe(true)
    }
  })
})

describe('solicitarRebaja', () => {
  it('llama a conta_ajuste_solicitar_rebaja con componente, importe y motivo', async () => {
    const r = await solicitarRebaja({
      clave: 'k1', documentoTabla: 'cuotas_condominio', documentoId: 'cu1', componente: 'mora', importe: 5, motivo: 'condonar mora',
    })
    expect(r).toEqual({ solicitud_id: 's1', estado: 'pendiente', repetida: false })
    expect(sb.rpc).toHaveBeenCalledWith('conta_ajuste_solicitar_rebaja', {
      p_id: 'k1', p_documento_tabla: 'cuotas_condominio', p_documento_id: 'cu1',
      p_componente: 'mora', p_importe: 5, p_motivo: 'condonar mora',
    })
  })
  it('tiene etiqueta en la lista de solicitudes', () => {
    expect(ETIQUETA_TIPO_AJUSTE.ajuste_importe).toBe('Rebajar importe (nota de crédito)')
  })
})
