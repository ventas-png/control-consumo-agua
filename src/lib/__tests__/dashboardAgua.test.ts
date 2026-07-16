import { describe, it, expect } from 'vitest'
import { resumenDashboardAgua } from '../dashboardAgua'
import type { Registro } from '../../types'

function reg(partial: Partial<Registro>): Registro {
  return {
    id: 'r1',
    cliente_id: 'c1',
    cliente_nombre: 'Cliente',
    fecha: '2026-07-10',
    lectura_anterior: 0,
    lectura_actual: 10,
    consumo: 10,
    tarifa_aplicada: 5,
    canon_aplicado: 20,
    monto_calculado: 70,
    tipo_cobro: 'consumo',
    estado: 'pendiente',
    ...partial,
  } as Registro
}

// Fecha de referencia fija: 15 de julio de 2026 (mediodía local).
const HOY = new Date(2026, 6, 15, 12)

describe('resumenDashboardAgua', () => {
  it('el mes actual NO mezcla el mismo mes de años anteriores (bug D2)', () => {
    const registros = [
      reg({ id: 'a', fecha: '2026-07-05', consumo: 10, monto_calculado: 100 }),
      // Julio pero de 2025: antes se sumaba al KPI del mes.
      reg({ id: 'b', fecha: '2025-07-05', consumo: 999, monto_calculado: 9999 }),
    ]
    const r = resumenDashboardAgua(registros, HOY)
    expect(r.consumoMes).toBe(10)
    expect(r.recaudoMes).toBe(100)
  })

  it('las fechas date-only del día 1 no caen al mes anterior (TZ-safe)', () => {
    // Sin parseFecha, '2026-07-01' se parsea como medianoche UTC y en GMT-6
    // cae al 30 de junio. El helper debe contarla en julio en cualquier huso.
    const r = resumenDashboardAgua([reg({ fecha: '2026-07-01', consumo: 7 })], HOY)
    expect(r.consumoMes).toBe(7)
    expect(r.serie.consumo[5]).toBe(7) // último bucket = mes actual
  })

  it('la serie de 6 meses agrupa por año+mes y etiqueta con año', () => {
    const registros = [
      reg({ id: 'a', fecha: '2026-07-10', consumo: 3 }),
      reg({ id: 'b', fecha: '2026-06-10', consumo: 5 }),
      reg({ id: 'c', fecha: '2026-02-10', consumo: 4 }), // ya fuera de la ventana
      reg({ id: 'd', fecha: '2025-06-10', consumo: 50 }), // junio del año pasado: fuera
    ]
    const r = resumenDashboardAgua(registros, HOY)
    expect(r.serie.labels).toEqual(['Feb 2026', 'Mar 2026', 'Abr 2026', 'May 2026', 'Jun 2026', 'Jul 2026'])
    expect(r.serie.consumo).toEqual([4, 0, 0, 0, 5, 3])
  })

  it('recaudo con fallback calcularTotalPagar cuando no hay monto_calculado', () => {
    const sinMonto = reg({ fecha: '2026-07-10', consumo: 10, tarifa_aplicada: 5 })
    delete (sinMonto as Partial<Registro>).monto_calculado
    const r = resumenDashboardAgua([sinMonto], HOY)
    // 10 m³ × Q5 = Q50 (tramo "Consumo Normal"; el canon solo aplica bajo el
    // mínimo) — misma fórmula que usaba el componente.
    expect(r.recaudoMes).toBe(50)
  })

  it('pendientes cuenta el histórico completo (comportamiento previo)', () => {
    const registros = [
      reg({ id: 'a', fecha: '2026-07-10', estado: 'pendiente' }),
      reg({ id: 'b', fecha: '2024-01-10', estado: 'pendiente' }),
      reg({ id: 'c', fecha: '2026-07-11', estado: 'pagado' }),
    ]
    expect(resumenDashboardAgua(registros, HOY).pendientes).toBe(2)
  })

  it('ignora fechas inválidas sin romper', () => {
    const r = resumenDashboardAgua([reg({ fecha: 'no-es-fecha', consumo: 5 })], HOY)
    expect(r.consumoMes).toBe(0)
    expect(r.serie.consumo.every(v => v === 0)).toBe(true)
  })
})
