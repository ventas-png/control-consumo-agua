import { describe, it, expect, vi } from 'vitest'

// RecargosTab importa supabase (throw sin env vars) en carga. Lo stubbeamos para
// poder importar el helper PURO diasTranscurridosCuota sin tocar la red ni el DOM.
vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => { throw new Error('default client should not be used in pure-logic tests') } },
}))

import { diasTranscurridosCuota } from '../tabs/RecargosTab'
import { calcularMoraCuota, type ReglaMora } from '../../../lib/businessCondominios'

// El cálculo del recargo de mora ahora delega en calcularMoraCuota (#398) en vez
// del antiguo `base * pct / 100`. Aquí cubrimos el helper que deriva los días de
// atraso (entrada de calcularMoraCuota) y la composición resultante.

describe('diasTranscurridosCuota', () => {
  it('cuenta días desde emitida_at (base preferida, como el cron)', () => {
    expect(diasTranscurridosCuota({ emitida_at: '2026-06-01T00:00:00.000Z' }, '2026-06-11')).toBe(10)
  })

  it('cae a created_at si no hay emitida_at', () => {
    expect(diasTranscurridosCuota({ created_at: '2026-05-01T00:00:00.000Z' }, '2026-05-31')).toBe(30)
  })

  it('cae a fecha_vencimiento si no hay emitida_at ni created_at', () => {
    expect(diasTranscurridosCuota({ fecha_vencimiento: '2026-06-01' }, '2026-06-06')).toBe(5)
  })

  it('sin ninguna fecha base → 0', () => {
    expect(diasTranscurridosCuota({}, '2026-06-06')).toBe(0)
  })

  it('nunca negativo (base futura → 0)', () => {
    expect(diasTranscurridosCuota({ emitida_at: '2026-12-01T00:00:00.000Z' }, '2026-06-01')).toBe(0)
  })
})

describe('recargo de cuota vía calcularMoraCuota (respeta vencimiento/gracia)', () => {
  const regla: ReglaMora = {
    tipo: 'porcentaje',
    valor: 10,
    aplicar_sobre: 'monto_cuota',
    dias_vencimiento: 30,
    periodo_gracia: 5,
  }

  it('dentro del vencimiento + gracia: NO aplica recargo', () => {
    // base creada hoy → 0 días < 30 venc → no aplica.
    const r = calcularMoraCuota(regla, 0, 500)
    expect(r.aplica).toBe(false)
    expect(r.monto).toBe(0)
  })

  it('pasado el vencimiento + gracia: aplica el % sobre el monto de la cuota', () => {
    // 40 días: atraso = 40 - 30 = 10 > gracia 5 → aplica 10% de 500 = 50.
    const r = calcularMoraCuota(regla, 40, 500)
    expect(r.aplica).toBe(true)
    expect(r.monto).toBe(50)
  })

  it('vencido pero aún en gracia: NO aplica', () => {
    // 33 días: atraso = 3 <= gracia 5 → no aplica.
    const r = calcularMoraCuota(regla, 33, 500)
    expect(r.aplica).toBe(false)
    expect(r.monto).toBe(0)
  })
})
