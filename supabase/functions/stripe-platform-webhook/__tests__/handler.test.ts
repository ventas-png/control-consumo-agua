// Tests del HANDLER completo de stripe-platform-webhook (P2: el webhook de
// billing SaaS estaba sin cubrir). Mismo harness que create/confirm-charge:
// Deno stubbeado, supabase-js remoto mockeado con el fake compartido, y el SDK
// de Stripe (esm.sh) mockeado con firma/retrieve controlables por test.
//
// Foco: verificación de firma, idempotencia por event_id (23505), y — el
// corazón del P0 #2 — la máquina de past_due_since del dunning: se fija al
// ENTRAR en past_due, NO se reinicia en reintentos, y se limpia al salir.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { emptyState, type FakeSupabaseState, type FakeWriteCall } from '../../_shared/__tests__/fakeSupabase.ts'

const h = vi.hoisted(() => ({
  env: {
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'srk-secret',
    STRIPE_PLATFORM_SECRET_KEY: 'sk_test_x',
    STRIPE_PLATFORM_WEBHOOK_SECRET: 'whsec_x',
    APP_URL: 'https://app.test',
  } as Record<string, string>,
  state: null as unknown as FakeSupabaseState,
  served: { handler: null as null | ((req: Request) => Promise<Response>) },
  stripe: {
    /** Evento que "verifica" constructEventAsync; null → lanza (firma inválida). */
    event: null as Record<string, unknown> | null,
    /** Subscription que devuelve subscriptions.retrieve (o lanza si retrieveThrows). */
    sub: null as Record<string, unknown> | null,
    retrieveThrows: false,
    updates: [] as unknown[],
  },
}))

vi.mock('https://esm.sh/@supabase/supabase-js@2', async () => {
  const { makeCreateClient } = await import('../../_shared/__tests__/fakeSupabase.ts')
  return { createClient: (...args: unknown[]) => makeCreateClient(h.state)(...(args as [string, string, { global?: unknown }?])) }
})

vi.mock('../../_shared/sentry.ts', () => ({ captureEdgeException: async () => undefined }))

vi.mock('https://esm.sh/stripe@17.4.0?target=deno', () => {
  class FakeStripe {
    webhooks = {
      constructEventAsync: async () => {
        if (!h.stripe.event) throw new Error('bad signature')
        return h.stripe.event
      },
    }
    subscriptions = {
      retrieve: async () => {
        if (h.stripe.retrieveThrows) throw new Error('stripe boom')
        return h.stripe.sub
      },
      update: async (_id: string, patch: unknown) => {
        h.stripe.updates.push(patch)
        return h.stripe.sub
      },
    }
    customers = {
      listTaxIds: async () => ({ data: [] }),
    }
  }
  return { default: FakeStripe }
})

beforeAll(async () => {
  h.state = emptyState()
  vi.stubGlobal('Deno', {
    env: { get: (k: string) => h.env[k] },
    serve: (fn: (req: Request) => Promise<Response>) => { h.served.handler = fn },
  })
  await import('../index.ts')
})

function post(headers: Record<string, string> = {}): Promise<Response> {
  return h.served.handler!(
    new Request('https://edge.test/stripe-platform-webhook', {
      method: 'POST',
      headers,
      body: '{}',
    }),
  )
}

/** Subscription de Stripe mínima con metadata de la empresa co1. */
function stripeSub(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sub_1',
    status: 'active',
    metadata: { company_id: 'co1', plan_code: 'pro' },
    items: { data: [{ price: { id: 'price_1' } }] },
    current_period_start: 1_750_000_000,
    current_period_end: 1_752_600_000,
    trial_end: null,
    canceled_at: null,
    cancel_at_period_end: false,
    customer: 'cus_1',
    ...overrides,
  }
}

/** Fixture base para eventos de subscription: empresa + plan + sub local existente. */
function fixtureSub(state: FakeSupabaseState, existing: Record<string, unknown> | null) {
  state.byTable.companies = { data: { id: 'co1' }, error: null }
  state.byTable.billing_plans = { data: { id: 'plan-1' }, error: null }
  state.byTable.subscriptions = { data: existing, error: null }
}

const updatesDe = (calls: FakeWriteCall[], table: string) =>
  calls.filter((c) => c.table === table && c.op === 'update').map((c) => c.payload as Record<string, unknown>)
const insertsDe = (calls: FakeWriteCall[], table: string) =>
  calls.filter((c) => c.table === table && c.op === 'insert').map((c) => c.payload as Record<string, unknown>)

beforeEach(() => {
  const fresh = emptyState()
  h.state.byTable = fresh.byTable
  h.state.readQueues = fresh.readQueues
  h.state.writes = fresh.writes
  h.state.calls = fresh.calls
  h.state.rpcCalls = fresh.rpcCalls
  h.state.rpcs = fresh.rpcs
  h.stripe.event = null
  h.stripe.sub = null
  h.stripe.retrieveThrows = false
  h.stripe.updates = []
})

describe('stripe-platform-webhook · verificación y protocolo', () => {
  it('405 si no es POST', async () => {
    const res = await h.served.handler!(new Request('https://edge.test/x', { method: 'GET' }))
    expect(res.status).toBe(405)
  })

  it('400 sin header stripe-signature', async () => {
    expect((await post()).status).toBe(400)
  })

  it('400 si la firma no verifica', async () => {
    h.stripe.event = null // constructEventAsync lanza
    const res = await post({ 'stripe-signature': 'sig' })
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/signature verification failed/)
  })

  it('idempotencia: event_id duplicado (23505) → 200 sin re-procesar', async () => {
    h.stripe.event = { id: 'evt_1', type: 'customer.subscription.updated', livemode: false, data: { object: stripeSub() } }
    h.state.writes.stripe_webhook_events = { data: null, error: { code: '23505', message: 'duplicate' } }
    const res = await post({ 'stripe-signature': 'sig' })
    expect(res.status).toBe(200)
    expect(await res.text()).toMatch(/already processed/)
    // Solo el intento de insert del evento; ninguna otra escritura.
    expect(h.state.calls.filter((c) => c.table !== 'stripe_webhook_events').length).toBe(0)
  })

  it('evento no manejado → 200 y el evento queda marcado como procesado', async () => {
    h.stripe.event = { id: 'evt_x', type: 'payment_intent.created', livemode: false, data: { object: {} } }
    const res = await post({ 'stripe-signature': 'sig' })
    expect(res.status).toBe(200)
    const marcado = updatesDe(h.state.calls, 'stripe_webhook_events')[0]
    expect(marcado.processed_at).toBeTruthy()
    expect(marcado.error_message).toBeNull()
  })

  it('error de procesamiento → 500 (Stripe reintenta) y error_message sellado', async () => {
    h.stripe.event = {
      id: 'evt_err', type: 'invoice.payment_failed', livemode: false,
      data: { object: { id: 'in_1', subscription: 'sub_1', amount_due: 100, currency: 'usd', status: 'open' } },
    }
    // La invoice encuentra la sub local, pero el retrieve a Stripe explota.
    h.state.byTable.subscriptions = { data: { id: 'sub-local', company_id: 'co1' }, error: null }
    h.state.byTable.invoices = { data: null, error: null }
    h.stripe.retrieveThrows = true
    const res = await post({ 'stripe-signature': 'sig' })
    expect(res.status).toBe(500)
    expect(updatesDe(h.state.calls, 'stripe_webhook_events')[0].error_message).toMatch(/stripe boom/)
  })
})

describe('stripe-platform-webhook · dunning P0 #2 (past_due_since)', () => {
  const evento = (sub: Record<string, unknown>) => ({
    id: 'evt_sub', type: 'customer.subscription.updated', livemode: false, data: { object: sub },
  })

  it('al ENTRAR en past_due fija past_due_since', async () => {
    h.stripe.event = evento(stripeSub({ status: 'past_due' }))
    fixtureSub(h.state, { id: 'sub-local', status: 'active', past_due_since: null })
    await post({ 'stripe-signature': 'sig' })
    const upd = updatesDe(h.state.calls, 'subscriptions')[0]
    expect(upd.status).toBe('past_due')
    expect(upd.past_due_since).toBeTruthy()
  })

  it('en REINTENTOS de past_due NO reinicia el reloj (conserva el past_due_since original)', async () => {
    const t0 = '2026-07-01T00:00:00.000Z'
    h.stripe.event = evento(stripeSub({ status: 'past_due' }))
    fixtureSub(h.state, { id: 'sub-local', status: 'past_due', past_due_since: t0 })
    await post({ 'stripe-signature': 'sig' })
    expect(updatesDe(h.state.calls, 'subscriptions')[0].past_due_since).toBe(t0)
  })

  it('al SALIR de past_due (recuperación) limpia past_due_since', async () => {
    h.stripe.event = evento(stripeSub({ status: 'active' }))
    fixtureSub(h.state, { id: 'sub-local', status: 'past_due', past_due_since: '2026-07-01T00:00:00.000Z' })
    await post({ 'stripe-signature': 'sig' })
    const upd = updatesDe(h.state.calls, 'subscriptions')[0]
    expect(upd.status).toBe('active')
    expect(upd.past_due_since).toBeNull()
  })

  it('sub sin fila local → INSERT (tras cancelar trials sin stripe_subscription_id)', async () => {
    h.stripe.event = evento(stripeSub())
    fixtureSub(h.state, null)
    await post({ 'stripe-signature': 'sig' })
    const ins = insertsDe(h.state.calls, 'subscriptions')[0]
    expect(ins).toMatchObject({ company_id: 'co1', plan_id: 'plan-1', status: 'active', stripe_subscription_id: 'sub_1' })
  })
})

describe('stripe-platform-webhook · invoice.payment_failed (dunning end-to-end)', () => {
  it('upserta la invoice, deja la sub en past_due y encola el correo de dunning al owner', async () => {
    h.stripe.event = {
      id: 'evt_fail', type: 'invoice.payment_failed', livemode: false,
      data: {
        object: {
          id: 'in_1', subscription: 'sub_1', amount_paid: 0, amount_due: 2900, subtotal: 2900,
          currency: 'usd', status: 'open', period_start: 1_750_000_000, period_end: 1_752_600_000,
          due_date: null, status_transitions: {}, invoice_pdf: null,
          total_tax_amounts: [], customer_tax_ids: [], customer_address: null,
        },
      },
    }
    h.stripe.sub = stripeSub({ status: 'past_due' })
    // Lecturas de `subscriptions` en orden: (1) por la invoice, (2) por el upsert de la sub.
    h.state.readQueues.subscriptions = [
      { data: { id: 'sub-local', company_id: 'co1' }, error: null },
      { data: { id: 'sub-local', status: 'active', past_due_since: null }, error: null },
    ]
    h.state.byTable.invoices = { data: null, error: null }
    h.state.byTable.companies = { data: { id: 'co1', nombre: 'Acme' }, error: null }
    h.state.byTable.billing_plans = { data: { id: 'plan-1' }, error: null }
    h.state.byTable.app_users = { data: { id: 'owner-1', email: 'owner@acme.com', full_name: 'Own Er' }, error: null }

    const res = await post({ 'stripe-signature': 'sig' })
    expect(res.status).toBe(200)

    // Invoice insertada como failed/open con el monto adeudado.
    const inv = insertsDe(h.state.calls, 'invoices')[0]
    expect(inv).toMatchObject({ company_id: 'co1', amount_cents: 2900, status: 'open', stripe_invoice_id: 'in_1' })

    // Subscription actualizada a past_due con el reloj de dunning iniciado.
    const upd = updatesDe(h.state.calls, 'subscriptions')[0]
    expect(upd.status).toBe('past_due')
    expect(upd.past_due_since).toBeTruthy()

    // Correo de dunning encolado vía RPC con el template correcto.
    const rpc = h.state.rpcCalls.find((c) => c.fn === 'enqueue_email')!
    expect(rpc).toBeTruthy()
    const args = rpc.args as Record<string, unknown>
    expect(args.p_company_id).toBe('co1')
    expect((args.p_payload as Record<string, unknown>).template_key).toBe('dunning_pago')
    expect((args.p_payload as Record<string, unknown>).to_email).toBe('owner@acme.com')
  })
})
