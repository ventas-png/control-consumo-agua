// Tests de la lógica pura de create-payment-intent (infra:I22 · Track T8/T5).
// Como el resto de tests de edge fns, corre bajo vitest (no Deno) tratando el
// módulo como TS normal. Cubre: validación del request (monto > 0 obligatorio),
// resolución de moneda con fallback a USD, conversión a CENTAVOS (redondeo, sin
// errores de flotantes) y construcción de los params del PaymentIntent
// (metadata multi-tenant + descripción con fallback).

import { describe, it, expect } from 'vitest'
import {
  STRIPE_SUPPORTED_CURRENCIES,
  buildPaymentIntentParams,
  esRequestValido,
  montoACentavos,
  resolveCurrency,
} from '../logic.ts'

const requestBase = {
  cliente_id: 'cli-1',
  registro_id: 'reg-1',
  company_id: 'co-1',
  monto: 150.5,
}

describe('create-payment-intent/esRequestValido', () => {
  it('acepta un request completo con monto positivo', () => {
    expect(esRequestValido(requestBase)).toBe(true)
    expect(esRequestValido({ ...requestBase, monto: 0.01 })).toBe(true)
  })

  it('rechaza monto 0, negativo o NaN (nunca cobrar $0 ni montos corruptos)', () => {
    expect(esRequestValido({ ...requestBase, monto: 0 })).toBe(false)
    expect(esRequestValido({ ...requestBase, monto: -10 })).toBe(false)
    expect(esRequestValido({ ...requestBase, monto: NaN })).toBe(false)
  })

  it('rechaza cualquier campo faltante o vacío', () => {
    expect(esRequestValido({ ...requestBase, cliente_id: '' })).toBe(false)
    expect(esRequestValido({ ...requestBase, registro_id: undefined })).toBe(false)
    expect(esRequestValido({ ...requestBase, company_id: '' })).toBe(false)
    expect(esRequestValido({})).toBe(false)
  })
})

describe('create-payment-intent/resolveCurrency', () => {
  it('usa la moneda de la empresa si Stripe la soporta (normalizada a minúsculas)', () => {
    expect(resolveCurrency('mxn')).toBe('mxn')
    expect(resolveCurrency('MXN')).toBe('mxn')
    expect(resolveCurrency('EUR')).toBe('eur')
  })

  it('cae a usd si no hay moneda o no está soportada', () => {
    expect(resolveCurrency(null)).toBe('usd')
    expect(resolveCurrency(undefined)).toBe('usd')
    expect(resolveCurrency('')).toBe('usd')
    expect(resolveCurrency('gtq')).toBe('usd') // GTQ NO está en el set de Stripe
    expect(resolveCurrency('btc')).toBe('usd')
  })

  it('el whitelist no incluye monedas fuera del set soportado por Stripe', () => {
    expect(STRIPE_SUPPORTED_CURRENCIES.has('usd')).toBe(true)
    expect(STRIPE_SUPPORTED_CURRENCIES.has('mxn')).toBe(true)
    expect(STRIPE_SUPPORTED_CURRENCIES.has('gtq')).toBe(false)
  })
})

describe('create-payment-intent/montoACentavos', () => {
  it('convierte unidades mayores a centavos', () => {
    expect(montoACentavos(150)).toBe(15000)
    expect(montoACentavos(0.01)).toBe(1)
  })

  it('redondea sin arrastrar errores de punto flotante', () => {
    // 150.5 * 100 = 15050.000000000002 en IEEE 754 → debe quedar 15050
    expect(montoACentavos(150.5)).toBe(15050)
    // 33.33 * 100 = 3332.9999999999995 → 3333
    expect(montoACentavos(33.33)).toBe(3333)
    expect(montoACentavos(19.99)).toBe(1999)
  })
})

describe('create-payment-intent/buildPaymentIntentParams', () => {
  // Guarda del recargo por pago con tarjeta. El handler cobra `totalConRecargo`,
  // no el monto base: si alguien vuelve a extraer este helper pasándole el monto
  // sin recargo, se le cobraría de menos al cliente. Estos dos tests fijan ese
  // contrato — el importe sale del `total`, y el recargo se declara al usuario
  // en la descripción del cargo.
  it('cobra el TOTAL (monto + recargo), no el monto base', () => {
    const conRecargo = buildPaymentIntentParams({
      ...requestBase, total: 155.55, currency: 'mxn', recargo: 5.05,
    })
    expect(conRecargo.amount).toBe(15555)
    expect(conRecargo.description).toContain('incluye recargo por pago con tarjeta 5.05 MXN')
  })

  it('sin recargo, la descripción no lo menciona', () => {
    const sinRecargo = buildPaymentIntentParams({
      ...requestBase, total: 150.50, currency: 'mxn', clienteNombre: 'Juan Pérez', recargo: null,
    })
    expect(sinRecargo.amount).toBe(15050)
    expect(sinRecargo.description).toBe('Pago de agua - Juan Pérez')
  })

  it('arma amount en centavos, currency y metadata de trazabilidad', () => {
    const params = buildPaymentIntentParams({
      ...requestBase,
      total: 150.50,
      currency: 'mxn',
      clienteNombre: 'Juan Pérez',
    })
    expect(params.amount).toBe(15050)
    expect(params.currency).toBe('mxn')
    expect(params.metadata).toEqual({
      cliente_id: 'cli-1',
      registro_id: 'reg-1',
      company_id: 'co-1',
    })
    expect(params.description).toBe('Pago de agua - Juan Pérez')
  })

  it('descripción cae a "Cliente" si no hay nombre', () => {
    const params = buildPaymentIntentParams({ ...requestBase, total: 150.50, currency: 'usd' })
    expect(params.description).toBe('Pago de agua - Cliente')
    const conNull = buildPaymentIntentParams({ ...requestBase, total: 150.50, currency: 'usd', clienteNombre: null })
    expect(conNull.description).toBe('Pago de agua - Cliente')
  })
})
