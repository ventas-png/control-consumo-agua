// Tests de la lógica pura de stripe-webhook-handler (infra:I22 · Track T8/T5).
// Como el resto de tests de edge fns, corre bajo vitest (no Deno) tratando el
// módulo como TS normal. Cubre la construcción de la fila de `pagos` que nace de
// un payment_intent.succeeded: defaults de auto-verificación (el webhook YA
// autenticó por firma), passthrough del monto (en unidades, NO centavos: espeja
// payment_requests.monto) y trazabilidad hacia el payment intent de Stripe.

import { describe, it, expect } from 'vitest'
import { buildPagoRow, type PaymentRequestRow } from '../logic.ts'

function requestEjemplo(over: Partial<PaymentRequestRow> = {}): PaymentRequestRow {
  return {
    id: 'pr-1',
    registro_id: 'reg-1',
    cliente_id: 'cli-1',
    company_id: 'co-1',
    monto: 150.5,
    ...over,
  }
}

describe('stripe-webhook-handler/buildPagoRow', () => {
  it('nace AUTO-VERIFICADO: estado y verification_status "verificado", verified_by "stripe_webhook"', () => {
    const row = buildPagoRow(requestEjemplo(), 'pi_123')
    expect(row.estado).toBe('verificado')
    expect(row.verification_status).toBe('verificado')
    expect(row.verified_by).toBe('stripe_webhook')
  })

  it('método y aplicación fijos del flujo Stripe: tarjeta_credito / pago_total', () => {
    const row = buildPagoRow(requestEjemplo(), 'pi_123')
    expect(row.metodo).toBe('tarjeta_credito')
    expect(row.tipo_aplicacion).toBe('pago_total')
  })

  it('el monto pasa TAL CUAL desde payment_requests (unidades, no centavos)', () => {
    expect(buildPagoRow(requestEjemplo({ monto: 150.5 }), 'pi_1').monto).toBe(150.5)
    expect(buildPagoRow(requestEjemplo({ monto: 0.01 }), 'pi_1').monto).toBe(0.01)
  })

  it('traza el payment intent en stripe_payment_intent_id Y en las notas', () => {
    const row = buildPagoRow(requestEjemplo(), 'pi_abc999')
    expect(row.stripe_payment_intent_id).toBe('pi_abc999')
    expect(row.notas).toBe('Pago automático de Stripe - pi_abc999')
  })

  it('copia registro_id/cliente_id del payment_request (incluye registro_id null)', () => {
    const row = buildPagoRow(requestEjemplo({ registro_id: null, cliente_id: 'cli-9' }), 'pi_1')
    expect(row.registro_id).toBeNull()
    expect(row.cliente_id).toBe('cli-9')
  })

  it('sin comprobante ni autor humano: comprobante_* / created_by / project_id en null', () => {
    const row = buildPagoRow(requestEjemplo(), 'pi_1')
    expect(row.comprobante_url).toBeNull()
    expect(row.comprobante_tipo).toBeNull()
    expect(row.created_by).toBeNull()
    expect(row.project_id).toBeNull()
  })

  it('verified_at usa el now inyectado (determinista) y por default un ISO parseable', () => {
    const row = buildPagoRow(requestEjemplo(), 'pi_1', '2026-07-09T12:00:00.000Z')
    expect(row.verified_at).toBe('2026-07-09T12:00:00.000Z')
    const antes = Date.now()
    const porDefecto = buildPagoRow(requestEjemplo(), 'pi_1')
    expect(Date.parse(porDefecto.verified_at)).toBeGreaterThanOrEqual(antes - 1000)
  })
})
