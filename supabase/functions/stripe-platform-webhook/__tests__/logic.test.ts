// Tests de la lógica pura de stripe-platform-webhook (infra:I22 · Track T8/T5,
// issue #321). Como el resto de tests de edge fns, corre bajo vitest (no Deno)
// tratando el módulo como TS normal. Cubre: mapeo de status de subscription e
// invoice (status desconocido NUNCA pasa el CHECK → cae a incomplete/open),
// construcción del row de subscription (epochs→ISO, fallbacks de periodo,
// billing_cycle, customer string|objeto), construcción del row de invoice
// (dinero en centavos: amount_paid vs amount_due, suma de tax, snapshot de
// tax_id), decisión del update de customer.updated e idempotencia (23505).

import { describe, it, expect } from 'vitest'
import {
  PG_UNIQUE_VIOLATION,
  buildCustomerUpdate,
  buildInvoiceRow,
  buildSubscriptionRow,
  isUniqueViolation,
  mapInvoiceStatus,
  mapStripeStatus,
  stripeRefId,
  type StripeInvoiceLike,
  type StripeSubscriptionLike,
} from '../logic.ts'

// Epochs fijos para tests deterministas (segundos, convención Stripe).
const T0 = Date.parse('2026-07-01T00:00:00.000Z') / 1000
const T1 = Date.parse('2026-08-01T00:00:00.000Z') / 1000
const NOW_MS = Date.parse('2026-07-09T12:00:00.000Z')

describe('stripe-platform-webhook/mapStripeStatus', () => {
  it('deja pasar los status del CHECK de subscriptions tal cual', () => {
    for (const s of ['trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid']) {
      expect(mapStripeStatus(s)).toBe(s)
    }
  })

  it('cualquier status desconocido cae a incomplete (no rompe el CHECK)', () => {
    expect(mapStripeStatus('paused')).toBe('incomplete') // Stripe sí lo emite
    expect(mapStripeStatus('')).toBe('incomplete')
    expect(mapStripeStatus('ACTIVE')).toBe('incomplete') // case-sensitive a propósito
    expect(mapStripeStatus('algo_nuevo_de_stripe')).toBe('incomplete')
  })
})

describe('stripe-platform-webhook/mapInvoiceStatus', () => {
  it('deja pasar los status válidos de invoice', () => {
    for (const s of ['draft', 'open', 'paid', 'void', 'uncollectible']) {
      expect(mapInvoiceStatus(s)).toBe(s)
    }
  })

  it('null/undefined/desconocido caen al default open', () => {
    expect(mapInvoiceStatus(null)).toBe('open')
    expect(mapInvoiceStatus(undefined)).toBe('open')
    expect(mapInvoiceStatus('')).toBe('open')
    expect(mapInvoiceStatus('deleted')).toBe('open')
  })
})

describe('stripe-platform-webhook/stripeRefId', () => {
  it('acepta la referencia como string (id directo)', () => {
    expect(stripeRefId('sub_123')).toBe('sub_123')
  })

  it('acepta la referencia expandida como objeto', () => {
    expect(stripeRefId({ id: 'sub_456' })).toBe('sub_456')
  })

  it('invoice sin subscription → undefined (el handler skipea)', () => {
    expect(stripeRefId(null)).toBeUndefined()
    expect(stripeRefId(undefined)).toBeUndefined()
  })
})

describe('stripe-platform-webhook/isUniqueViolation (idempotencia)', () => {
  it('23505 (duplicate key) → evento ya procesado, responder 200 sin re-aplicar', () => {
    expect(isUniqueViolation('23505')).toBe(true)
    expect(isUniqueViolation(PG_UNIQUE_VIOLATION)).toBe(true)
  })

  it('cualquier otro error de DB NO es idempotencia (debe ir a 500 para retry)', () => {
    expect(isUniqueViolation('23503')).toBe(false) // FK violation
    expect(isUniqueViolation('42P01')).toBe(false)
    expect(isUniqueViolation(undefined)).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation('')).toBe(false)
  })
})

describe('stripe-platform-webhook/buildSubscriptionRow', () => {
  const baseSub: StripeSubscriptionLike = {
    id: 'sub_abc',
    status: 'active',
    metadata: { company_id: 'co_1', plan_code: 'basico', billing_cycle: 'monthly' },
    current_period_start: T0,
    current_period_end: T1,
    trial_end: null,
    canceled_at: null,
    cancel_at_period_end: false,
    customer: 'cus_123',
  }

  it('convierte epochs (segundos) a ISO y arma el row completo', () => {
    const row = buildSubscriptionRow(baseSub, 'co_1', 'plan_1', NOW_MS)
    expect(row).toEqual({
      company_id: 'co_1',
      plan_id: 'plan_1',
      status: 'active',
      billing_cycle: 'monthly',
      current_period_start: '2026-07-01T00:00:00.000Z',
      current_period_end: '2026-08-01T00:00:00.000Z',
      trial_end: null,
      canceled_at: null,
      cancel_at_period_end: false,
      stripe_subscription_id: 'sub_abc',
      stripe_customer_id: 'cus_123',
    })
  })

  it('period_start ausente → fallback a now; period_end ausente → now + 30 días', () => {
    const row = buildSubscriptionRow(
      { ...baseSub, current_period_start: null, current_period_end: null },
      'co_1', 'plan_1', NOW_MS,
    )
    expect(row.current_period_start).toBe(new Date(NOW_MS).toISOString())
    expect(row.current_period_end).toBe(new Date(NOW_MS + 30 * 24 * 60 * 60 * 1000).toISOString())
  })

  it('billing_cycle solo es yearly con metadata explícita; todo lo demás → monthly', () => {
    expect(buildSubscriptionRow({ ...baseSub, metadata: { billing_cycle: 'yearly' } }, 'co_1', 'p', NOW_MS).billing_cycle).toBe('yearly')
    expect(buildSubscriptionRow({ ...baseSub, metadata: { billing_cycle: 'YEARLY' } }, 'co_1', 'p', NOW_MS).billing_cycle).toBe('monthly')
    expect(buildSubscriptionRow({ ...baseSub, metadata: {} }, 'co_1', 'p', NOW_MS).billing_cycle).toBe('monthly')
    expect(buildSubscriptionRow({ ...baseSub, metadata: null }, 'co_1', 'p', NOW_MS).billing_cycle).toBe('monthly')
  })

  it('customer expandido como objeto → toma el id', () => {
    const row = buildSubscriptionRow({ ...baseSub, customer: { id: 'cus_obj' } }, 'co_1', 'p', NOW_MS)
    expect(row.stripe_customer_id).toBe('cus_obj')
  })

  it('trial_end y canceled_at: epoch → ISO; ausentes → null', () => {
    const withDates = buildSubscriptionRow({ ...baseSub, trial_end: T0, canceled_at: T1 }, 'co_1', 'p', NOW_MS)
    expect(withDates.trial_end).toBe('2026-07-01T00:00:00.000Z')
    expect(withDates.canceled_at).toBe('2026-08-01T00:00:00.000Z')
    const without = buildSubscriptionRow({ ...baseSub, trial_end: null, canceled_at: undefined }, 'co_1', 'p', NOW_MS)
    expect(without.trial_end).toBeNull()
    expect(without.canceled_at).toBeNull()
  })

  it('cancel_at_period_end se coerce a boolean estricto (undefined/null → false)', () => {
    expect(buildSubscriptionRow({ ...baseSub, cancel_at_period_end: true }, 'co_1', 'p', NOW_MS).cancel_at_period_end).toBe(true)
    expect(buildSubscriptionRow({ ...baseSub, cancel_at_period_end: null }, 'co_1', 'p', NOW_MS).cancel_at_period_end).toBe(false)
    expect(buildSubscriptionRow({ ...baseSub, cancel_at_period_end: undefined }, 'co_1', 'p', NOW_MS).cancel_at_period_end).toBe(false)
  })

  it('el status pasa por mapStripeStatus (paused → incomplete)', () => {
    expect(buildSubscriptionRow({ ...baseSub, status: 'paused' }, 'co_1', 'p', NOW_MS).status).toBe('incomplete')
  })
})

describe('stripe-platform-webhook/buildInvoiceRow', () => {
  const baseInvoice: StripeInvoiceLike = {
    id: 'in_1',
    currency: 'mxn',
    amount_paid: 0,
    amount_due: 149900,
    subtotal: 129224,
    status: 'open',
    total_tax_amounts: [],
    customer_tax_ids: [],
    customer_address: null,
    period_start: T0,
    period_end: T1,
    due_date: null,
    status_transitions: null,
    invoice_pdf: null,
  }

  it('dinero en centavos: amount_paid gana cuando > 0', () => {
    const row = buildInvoiceRow({ ...baseInvoice, amount_paid: 149900, status: 'paid' }, 'sub_l', 'co_1', NOW_MS)
    expect(row.amount_cents).toBe(149900)
  })

  it('invoice aún no pagada (amount_paid = 0) → usa amount_due', () => {
    const row = buildInvoiceRow(baseInvoice, 'sub_l', 'co_1', NOW_MS)
    expect(row.amount_cents).toBe(149900)
    expect(row.status).toBe('open')
  })

  it('suma total_tax_amounts (entradas sin amount cuentan como 0)', () => {
    const row = buildInvoiceRow(
      { ...baseInvoice, total_tax_amounts: [{ amount: 20676 }, { amount: null }, {}] },
      'sub_l', 'co_1', NOW_MS,
    )
    expect(row.tax_amount_cents).toBe(20676)
  })

  it('total_tax_amounts no-array (null) → tax 0', () => {
    expect(buildInvoiceRow({ ...baseInvoice, total_tax_amounts: null }, 'sub_l', 'co_1', NOW_MS).tax_amount_cents).toBe(0)
  })

  it('snapshot del PRIMER customer_tax_id; array vacío o null → nulls', () => {
    const conRfc = buildInvoiceRow(
      { ...baseInvoice, customer_tax_ids: [{ type: 'mx_rfc', value: 'MRE123456ABC' }, { type: 'eu_vat', value: 'X' }] },
      'sub_l', 'co_1', NOW_MS,
    )
    expect(conRfc.tax_id).toBe('MRE123456ABC')
    expect(conRfc.tax_id_type).toBe('mx_rfc')

    const sinRfc = buildInvoiceRow({ ...baseInvoice, customer_tax_ids: [] }, 'sub_l', 'co_1', NOW_MS)
    expect(sinRfc.tax_id).toBeNull()
    expect(sinRfc.tax_id_type).toBeNull()

    const nullIds = buildInvoiceRow({ ...baseInvoice, customer_tax_ids: null }, 'sub_l', 'co_1', NOW_MS)
    expect(nullIds.tax_id).toBeNull()
    expect(nullIds.tax_id_type).toBeNull()
  })

  it('country_billed viene de customer_address; ausente → null', () => {
    expect(buildInvoiceRow({ ...baseInvoice, customer_address: { country: 'MX' } }, 'sub_l', 'co_1', NOW_MS).country_billed).toBe('MX')
    expect(buildInvoiceRow(baseInvoice, 'sub_l', 'co_1', NOW_MS).country_billed).toBeNull()
  })

  it('status desconocido/null pasa por mapInvoiceStatus → open', () => {
    expect(buildInvoiceRow({ ...baseInvoice, status: null }, 'sub_l', 'co_1', NOW_MS).status).toBe('open')
    expect(buildInvoiceRow({ ...baseInvoice, status: 'deleted' }, 'sub_l', 'co_1', NOW_MS).status).toBe('open')
  })

  it('periodos: epoch → ISO; ausentes → fallback a now', () => {
    const row = buildInvoiceRow(baseInvoice, 'sub_l', 'co_1', NOW_MS)
    expect(row.period_start).toBe('2026-07-01T00:00:00.000Z')
    expect(row.period_end).toBe('2026-08-01T00:00:00.000Z')

    const sinPeriodo = buildInvoiceRow({ ...baseInvoice, period_start: null, period_end: null }, 'sub_l', 'co_1', NOW_MS)
    expect(sinPeriodo.period_start).toBe(new Date(NOW_MS).toISOString())
    expect(sinPeriodo.period_end).toBe(new Date(NOW_MS).toISOString())
  })

  it('due_date y paid_at: epoch → ISO; ausentes → null', () => {
    const row = buildInvoiceRow(
      { ...baseInvoice, due_date: T1, status_transitions: { paid_at: T0 } },
      'sub_l', 'co_1', NOW_MS,
    )
    expect(row.due_date).toBe('2026-08-01T00:00:00.000Z')
    expect(row.paid_at).toBe('2026-07-01T00:00:00.000Z')

    const sin = buildInvoiceRow(baseInvoice, 'sub_l', 'co_1', NOW_MS)
    expect(sin.due_date).toBeNull()
    expect(sin.paid_at).toBeNull()
  })

  it('ancla el row a la subscription LOCAL resuelta por el handler', () => {
    const row = buildInvoiceRow(baseInvoice, 'sub_local_9', 'co_7', NOW_MS)
    expect(row.subscription_id).toBe('sub_local_9')
    expect(row.company_id).toBe('co_7')
    expect(row.stripe_invoice_id).toBe('in_1')
  })
})

describe('stripe-platform-webhook/buildCustomerUpdate (customer.updated)', () => {
  it('solo entran los campos de address presentes', () => {
    const update = buildCustomerUpdate(
      { country: 'MX', line1: 'Av. Siempre Viva 742', city: null, state: '', postal_code: '97000' },
      null,
    )
    expect(update).toEqual({
      country: 'MX',
      address_line1: 'Av. Siempre Viva 742',
      address_postal_code: '97000',
    })
  })

  it('tax_id y tax_id_type solo entran juntos y solo si hay value', () => {
    expect(buildCustomerUpdate(null, { type: 'mx_rfc', value: 'MRE123456ABC' })).toEqual({
      tax_id: 'MRE123456ABC',
      tax_id_type: 'mx_rfc',
    })
    // Sin value NO debe escribirse ni siquiera el type (no pisar datos fiscales).
    expect(buildCustomerUpdate(null, { type: 'mx_rfc', value: null })).toEqual({})
    expect(buildCustomerUpdate(null, { type: 'mx_rfc', value: '' })).toEqual({})
  })

  it('sin address ni tax_id → objeto vacío (el handler NO ejecuta el update)', () => {
    expect(buildCustomerUpdate(null, null)).toEqual({})
    expect(buildCustomerUpdate(undefined, undefined)).toEqual({})
    expect(buildCustomerUpdate({}, undefined)).toEqual({})
  })

  it('address completa + tax_id → update con los 7 campos', () => {
    const update = buildCustomerUpdate(
      { country: 'MX', line1: 'Calle 60 #491', city: 'Mérida', state: 'Yucatán', postal_code: '97000' },
      { type: 'mx_rfc', value: 'MRE123456ABC' },
    )
    expect(Object.keys(update).sort()).toEqual([
      'address_city', 'address_line1', 'address_postal_code', 'address_state',
      'country', 'tax_id', 'tax_id_type',
    ])
  })
})
