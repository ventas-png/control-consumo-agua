// E8: sólo un estado FINAL de Stripe decide; lo demás es pendiente.
import { describe, it, expect, vi } from 'vitest'
import { consultarPaymentIntentStripe, estadoDePaymentIntentStripe } from '../stripeConsulta.ts'

describe('estadoDePaymentIntentStripe', () => {
  it('succeeded → aprobado; canceled → rechazado; el resto pendiente', () => {
    expect(estadoDePaymentIntentStripe('succeeded')).toBe('aprobado')
    expect(estadoDePaymentIntentStripe('canceled')).toBe('rechazado')
    for (const s of ['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture', undefined]) {
      expect(estadoDePaymentIntentStripe(s)).toBe('pendiente')
    }
  })
})

describe('consultarPaymentIntentStripe', () => {
  it('pide el PaymentIntent con la clave como Bearer', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ status: 'canceled' }), { status: 200 }))
    const r = await consultarPaymentIntentStripe('pi_1', 'sk_x', f as unknown as typeof fetch)
    expect(f).toHaveBeenCalledWith('https://api.stripe.com/v1/payment_intents/pi_1', { headers: { Authorization: 'Bearer sk_x' } })
    expect(r).toMatchObject({ ok: true, estado: 'rechazado', referencia: 'pi_1' })
  })
  it('un error de Stripe es error (no libera nada)', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'No such payment_intent' } }), { status: 404 }))
    expect(await consultarPaymentIntentStripe('pi_x', 'sk', f as unknown as typeof fetch))
      .toMatchObject({ ok: false, estado: 'error', error: 'No such payment_intent' })
  })
})
