import { describe, it, expect } from 'vitest'
import {
  normalizarEstadoCuota,
  puedeTransicionarCuota,
  aplicarTransicionCuota,
  cuotaVencida,
  calcularMoraCuota,
  calcularTotalCuota,
  type ReglaMora,
} from '../businessCondominios'
import { calcularMora } from '../business'

// ════════════════════════════════════════════════════════════════════════════
// cond:C4 / cond:C6 — Agregado Cuota de condominio (lógica pura).
// ════════════════════════════════════════════════════════════════════════════

describe('normalizarEstadoCuota', () => {
  it('deja pasar los estados canónicos sin cambios', () => {
    for (const e of ['pendiente', 'emitida', 'pagada', 'vencida', 'anulada'] as const) {
      expect(normalizarEstadoCuota(e)).toBe(e)
    }
  })

  it('mapea el legacy de condominios: pagado→pagada, moroso→vencida', () => {
    expect(normalizarEstadoCuota('pagado')).toBe('pagada')
    expect(normalizarEstadoCuota('moroso')).toBe('vencida')
  })

  it('null/undefined/desconocido → pendiente (inicial seguro)', () => {
    expect(normalizarEstadoCuota(null)).toBe('pendiente')
    expect(normalizarEstadoCuota(undefined)).toBe('pendiente')
    expect(normalizarEstadoCuota('lo_que_sea')).toBe('pendiente')
  })

  it('NO confunde el legacy de agua: "mora" no es un estado de cuota → pendiente', () => {
    // agua usa 'mora'; condominios usa 'moroso'. 'mora' no está en el conjunto
    // legacy de cuota, así que cae al inicial seguro.
    expect(normalizarEstadoCuota('mora')).toBe('pendiente')
  })
})

describe('puedeTransicionarCuota', () => {
  it('pendiente → emitir → emitida', () => {
    expect(puedeTransicionarCuota('pendiente', 'emitir')).toEqual({ ok: true, estado: 'emitida' })
  })

  it('emitida → pagar/vencer/anular', () => {
    expect(puedeTransicionarCuota('emitida', 'pagar')).toEqual({ ok: true, estado: 'pagada' })
    expect(puedeTransicionarCuota('emitida', 'vencer')).toEqual({ ok: true, estado: 'vencida' })
    expect(puedeTransicionarCuota('emitida', 'anular').estado).toBe('anulada')
  })

  it('vencida → pagar y vencida → anular permitidos', () => {
    expect(puedeTransicionarCuota('vencida', 'pagar')).toEqual({ ok: true, estado: 'pagada' })
    expect(puedeTransicionarCuota('vencida', 'anular').estado).toBe('anulada')
  })

  it('acepta el legacy "moroso" como vencida y permite pagarla', () => {
    expect(puedeTransicionarCuota('moroso', 'pagar')).toEqual({ ok: true, estado: 'pagada' })
  })

  it('estados terminales (pagada/anulada y su legacy) rechazan toda acción', () => {
    expect(puedeTransicionarCuota('pagada', 'anular').ok).toBe(false)
    expect(puedeTransicionarCuota('pagado', 'pagar').ok).toBe(false) // legacy pagado
    expect(puedeTransicionarCuota('anulada', 'emitir').ok).toBe(false)
  })

  it('transiciones inválidas devuelven ok:false con mensaje', () => {
    const r = puedeTransicionarCuota('pendiente', 'pagar')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/inválida/i)
    expect(puedeTransicionarCuota('pendiente', 'vencer').ok).toBe(false)
    expect(puedeTransicionarCuota('emitida', 'emitir').ok).toBe(false)
  })
})

describe('aplicarTransicionCuota', () => {
  const T = '2026-06-04T12:00:00.000Z'

  it('emitir setea cuota_estado=emitida y emitida_at', () => {
    const p = aplicarTransicionCuota('pendiente', 'emitir', T)
    expect(p).toEqual({ cuota_estado: 'emitida', emitida_at: T })
  })

  it('pagar setea cuota_estado=pagada y pagada_at', () => {
    const p = aplicarTransicionCuota('emitida', 'pagar', T)
    expect(p).toEqual({ cuota_estado: 'pagada', pagada_at: T })
  })

  it('vencer setea cuota_estado=vencida y vencida_at', () => {
    const p = aplicarTransicionCuota('emitida', 'vencer', T)
    expect(p).toEqual({ cuota_estado: 'vencida', vencida_at: T })
  })

  it('anular desde vencida (legacy moroso) setea anulada_at', () => {
    const p = aplicarTransicionCuota('moroso', 'anular', T)
    expect(p).toEqual({ cuota_estado: 'anulada', anulada_at: T })
  })

  it('lanza en transición inválida', () => {
    expect(() => aplicarTransicionCuota('pagada', 'anular', T)).toThrow(/inválida/i)
    expect(() => aplicarTransicionCuota('pendiente', 'pagar', T)).toThrow()
  })

  it('usa new Date() cuando no se pasa `ahora`', () => {
    const p = aplicarTransicionCuota('pendiente', 'emitir')
    expect(p.cuota_estado).toBe('emitida')
    expect(typeof p.emitida_at).toBe('string')
  })
})

describe('cuotaVencida', () => {
  const HOY = '2026-06-04'

  it('false si no hay fecha de vencimiento', () => {
    expect(cuotaVencida(null, 'pendiente', HOY)).toBe(false)
    expect(cuotaVencida(undefined, 'emitida', HOY)).toBe(false)
  })

  it('true si la fecha ya pasó y la cuota no está saldada/anulada', () => {
    expect(cuotaVencida('2026-06-01', 'pendiente', HOY)).toBe(true)
    expect(cuotaVencida('2026-06-01', 'emitida', HOY)).toBe(true)
  })

  it('false si la fecha es hoy o futura (aún no vence)', () => {
    expect(cuotaVencida('2026-06-04', 'pendiente', HOY)).toBe(false) // hoy mismo
    expect(cuotaVencida('2026-07-01', 'emitida', HOY)).toBe(false)
  })

  it('false si la cuota ya está pagada o anulada (aunque la fecha pasó)', () => {
    expect(cuotaVencida('2026-06-01', 'pagada', HOY)).toBe(false)
    expect(cuotaVencida('2026-06-01', 'pagado', HOY)).toBe(false) // legacy
    expect(cuotaVencida('2026-06-01', 'anulada', HOY)).toBe(false)
  })

  it('una cuota legacy "moroso" con fecha pasada sigue contando como vencida', () => {
    // moroso → vencida (no terminal) → puede volver a evaluarse como vencida.
    expect(cuotaVencida('2026-06-01', 'moroso', HOY)).toBe(true)
  })
})

describe('calcularMoraCuota — paridad con calcularMora (saldo=cuota=monto)', () => {
  const reglaPct: ReglaMora = {
    tipo: 'porcentaje',
    valor: 5,
    aplicar_sobre: 'saldo_vencido',
    dias_vencimiento: 30,
    periodo_gracia: 0,
  }

  it('porcentaje: 5% de 1000 a 40 días (10 de atraso) = 50', () => {
    const r = calcularMoraCuota(reglaPct, 40, 1000)
    expect(r.aplica).toBe(true)
    expect(r.diasAtraso).toBe(10)
    expect(r.monto).toBe(50)
    expect(r.base).toBe(1000)
  })

  it('equivale a calcularMora con saldoVencido y montoCuota ambos = monto', () => {
    const directo = calcularMora(reglaPct, 45, 1200, 1200)
    const cuota = calcularMoraCuota(reglaPct, 45, 1200)
    expect(cuota).toEqual(directo)
  })

  it('aplicar_sobre=monto_cuota da el mismo resultado (base=monto en ambos)', () => {
    const reglaCuota: ReglaMora = { ...reglaPct, aplicar_sobre: 'monto_cuota' }
    const sobreSaldo = calcularMoraCuota(reglaPct, 40, 800)
    const sobreCuota = calcularMoraCuota(reglaCuota, 40, 800)
    expect(sobreCuota.monto).toBe(sobreSaldo.monto)
    expect(sobreCuota.monto).toBe(40) // 5% de 800
  })

  it('monto_fijo ignora la base: recargo plano', () => {
    const reglaFija: ReglaMora = { tipo: 'monto_fijo', valor: 75, dias_vencimiento: 30, periodo_gracia: 0 }
    const r = calcularMoraCuota(reglaFija, 60, 500)
    expect(r.aplica).toBe(true)
    expect(r.monto).toBe(75)
  })

  it('no aplica si aún no venció (días <= dias_vencimiento)', () => {
    const r = calcularMoraCuota(reglaPct, 30, 1000)
    expect(r.aplica).toBe(false)
    expect(r.diasAtraso).toBe(0)
    expect(r.monto).toBe(0)
  })

  it('no aplica dentro del periodo de gracia', () => {
    const reglaGracia: ReglaMora = { ...reglaPct, periodo_gracia: 5 }
    // 33 días = 3 de atraso, <= 5 de gracia → no aplica
    const r = calcularMoraCuota(reglaGracia, 33, 1000)
    expect(r.aplica).toBe(false)
    expect(r.diasAtraso).toBe(3)
  })

  it('monto no positivo → base 0 → no aplica (porcentaje)', () => {
    const r = calcularMoraCuota(reglaPct, 60, 0)
    expect(r.aplica).toBe(false)
    expect(r.base).toBe(0)
  })

  it('redondea a 2 decimales (half away from zero)', () => {
    // 5% de 333.30 = 16.665 → 16.67
    const r = calcularMoraCuota(reglaPct, 40, 333.3)
    expect(r.monto).toBe(16.67)
  })
})

describe('calcularTotalCuota — sin IVA', () => {
  it('total = monto + mora (IVA no aplica)', () => {
    const d = calcularTotalCuota(1000, 50)
    expect(d.subtotal).toBe(1000)
    expect(d.mora_monto).toBe(50)
    expect(d.total_a_pagar).toBe(1050)
  })

  it('sin mora, total = monto', () => {
    const d = calcularTotalCuota(750)
    expect(d.subtotal).toBe(750)
    expect(d.mora_monto).toBe(0)
    expect(d.total_a_pagar).toBe(750)
  })

  it('mora negativa/inválida se normaliza a 0', () => {
    const d = calcularTotalCuota(500, -20)
    expect(d.mora_monto).toBe(0)
    expect(d.total_a_pagar).toBe(500)
  })

  it('redondea el total a 2 decimales', () => {
    const d = calcularTotalCuota(100.105, 0.001)
    // 100.105 → 100.11 (base redondeada en calcularTotalFactura), mora 0.001→0 (no >0 redondeado a 0)
    expect(d.subtotal).toBe(100.11)
    expect(Number.isInteger(d.total_a_pagar * 100)).toBe(true)
  })
})
