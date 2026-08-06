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

  it('sin ninguna fecha base → 0', () => {
    expect(diasTranscurridosCuota({}, '2026-06-06')).toBe(0)
  })

  it('nunca negativo (base futura → 0)', () => {
    expect(diasTranscurridosCuota({ emitida_at: '2026-12-01T00:00:00.000Z' }, '2026-06-01')).toBe(0)
  })

  // ── Paridad con el cron que COBRA el recargo (auditoría 2026-07-28, PR-23) ──
  // Referencia: 20260604181000_aplicar_mora_cuotas_cron.sql:137-139
  //   floor(EXTRACT(EPOCH FROM (now() - COALESCE(emitida_at, created_at))) / 86400.0)
  // Si el TS y el SQL divergen, la vista previa del admin y el cargo efectivo
  // cruzan el umbral dias_vencimiento+periodo_gracia en momentos distintos.
  describe('paridad con el cron de mora', () => {
    /** Réplica exacta del SQL: resta de instantes completos y floor. */
    const diasSegunCron = (baseISO: string, ahoraISO: string): number =>
      Math.floor((new Date(ahoraISO).getTime() - new Date(baseISO).getTime()) / 86_400_000)

    it('mide instante contra instante, no contra medianoche UTC', () => {
      // Este es el caso que fallaba: la implementación anterior comparaba contra
      // `new Date().toISOString().slice(0,10)` (medianoche UTC), descontando la
      // fracción de día ya transcurrida.
      const base = '2026-06-01T02:00:00.000Z'
      const ahora = '2026-07-01T20:00:00.000Z'
      expect(diasSegunCron(base, ahora)).toBe(30)
      expect(diasTranscurridosCuota({ emitida_at: base }, new Date(ahora))).toBe(30)

      // Lo que daba antes (medianoche UTC del mismo día) era uno menos.
      expect(diasTranscurridosCuota({ emitida_at: base }, '2026-07-01')).toBe(29)
    })

    it('coincide con el cron en una malla de horas de emisión y de consulta', () => {
      const desajustes: string[] = []
      for (const horaBase of [0, 2, 6, 11, 18, 23]) {
        for (const horaAhora of [0, 3, 9, 14, 20, 23]) {
          const base = `2026-06-01T${String(horaBase).padStart(2, '0')}:00:00.000Z`
          const ahora = `2026-07-01T${String(horaAhora).padStart(2, '0')}:00:00.000Z`
          const esperado = diasSegunCron(base, ahora)
          const obtenido = diasTranscurridosCuota({ emitida_at: base }, new Date(ahora))
          if (obtenido !== esperado) desajustes.push(`${base}→${ahora}: ${obtenido} ≠ ${esperado}`)
        }
      }
      expect(desajustes).toEqual([])
    })

    it('sin emitida_at ni created_at devuelve 0, como el cron (COALESCE → NULL)', () => {
      // El SQL obtiene NULL y no aplica mora. Antes el TS caía a
      // fecha_vencimiento e inventaba una base, mostrando mora que nadie cobra.
      expect(diasTranscurridosCuota({ emitida_at: null, created_at: null }, '2026-07-01')).toBe(0)
    })
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
