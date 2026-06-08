// Cobros pluggable — Tests del resolver de payfac efectivo (override empresa↔
// locación). Fuente de verdad Vite; su espejo Deno tiene un smoke test paralelo.
import { describe, it, expect } from 'vitest'
import {
  resolverConfigPagoEfectiva,
  normalizarMonedaISO,
  MONEDA_PAGO_DEFAULT,
  PROVEEDOR_PAGO_DEFAULT,
} from '../businessPagos'

describe('resolverConfigPagoEfectiva', () => {
  it('sin locación: hereda el payfac y la moneda de la empresa', () => {
    const c = resolverConfigPagoEfectiva({ proveedorPago: 'qpaypro', monedaDefault: 'GTQ' })
    expect(c.proveedorPago).toBe('qpaypro')
    expect(c.moneda).toBe('GTQ')
    expect(c.desdeLocacion).toBe(false)
  })

  it('override de locación gana sobre la empresa', () => {
    const c = resolverConfigPagoEfectiva(
      { proveedorPago: 'sandbox', monedaDefault: 'USD' },
      { proveedorPago: 'qpaypro' },
    )
    expect(c.proveedorPago).toBe('qpaypro')
    expect(c.moneda).toBe('USD') // la moneda es del tenant (no se overridea por locación)
    expect(c.desdeLocacion).toBe(true)
  })

  it('override vacío/whitespace en la locación = hereda (no es override)', () => {
    const c = resolverConfigPagoEfectiva({ proveedorPago: 'qpaypro' }, { proveedorPago: '   ' })
    expect(c.proveedorPago).toBe('qpaypro')
    expect(c.desdeLocacion).toBe(false)
  })

  it('null override = hereda', () => {
    const c = resolverConfigPagoEfectiva({ proveedorPago: 'visanet' }, { proveedorPago: null })
    expect(c.proveedorPago).toBe('visanet')
    expect(c.desdeLocacion).toBe(false)
  })

  it('defaults seguros cuando todo está vacío', () => {
    const c = resolverConfigPagoEfectiva(null, null)
    expect(c.proveedorPago).toBe(PROVEEDOR_PAGO_DEFAULT)
    expect(c.moneda).toBe(MONEDA_PAGO_DEFAULT)
    expect(c.desdeLocacion).toBe(false)
  })

  it('normaliza proveedor a minúsculas y moneda a mayúsculas', () => {
    const c = resolverConfigPagoEfectiva({ proveedorPago: 'QPayPro', monedaDefault: 'gtq' })
    expect(c.proveedorPago).toBe('qpaypro')
    expect(c.moneda).toBe('GTQ')
  })
})

describe('normalizarMonedaISO', () => {
  it("mapea el símbolo 'Q' (projects.moneda) a GTQ", () => {
    expect(normalizarMonedaISO('Q')).toBe('GTQ')
    expect(normalizarMonedaISO('q')).toBe('GTQ')
    expect(normalizarMonedaISO('Q.')).toBe('GTQ')
    expect(normalizarMonedaISO('GTQ')).toBe('GTQ')
  })

  it("mapea '$' / 'usd' a USD", () => {
    expect(normalizarMonedaISO('$')).toBe('USD')
    expect(normalizarMonedaISO('usd')).toBe('USD')
    expect(normalizarMonedaISO('US$')).toBe('USD')
  })

  it('respeta un código ISO de 3 letras (en mayúsculas)', () => {
    expect(normalizarMonedaISO('MXN')).toBe('MXN')
    expect(normalizarMonedaISO('eur')).toBe('EUR')
  })

  it('vacío / null / símbolo desconocido → GTQ (default seguro)', () => {
    expect(normalizarMonedaISO('')).toBe('GTQ')
    expect(normalizarMonedaISO(null)).toBe('GTQ')
    expect(normalizarMonedaISO(undefined)).toBe('GTQ')
    expect(normalizarMonedaISO('€')).toBe('GTQ')
  })
})
