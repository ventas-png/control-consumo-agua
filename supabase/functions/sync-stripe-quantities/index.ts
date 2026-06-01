import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17.4.0?target=deno'
import {
  computeExpectedQuantities,
  planSyncOps,
  type StripeSubItem,
  type PlanPriceIds,
  type SyncOp,
} from '../_shared/billingSync.ts'

// sync-stripe-quantities (F2.15d): worker que ajusta las quantities de cada
// subscription_item a Stripe segun el uso real. Dispara pg_cron diario.
//
// Para cada subscription con status IN ('trialing','active','past_due','incomplete'):
//   1. Lee el plan asociado y los 4 stripe_price_id correspondientes.
//   2. Llama calculate_monthly_total_cents para obtener el desglose de uso.
//   3. Trae la subscription de Stripe con sus items.
//   4. planSyncOps decide que update/add/remove hacer.
//   5. Aplica con proration_behavior='create_prorations' — Stripe prorratea
//      el cobro pendiente del periodo actual.
//   6. Inserta una fila en billing_sync_log con outcome + changes.
//
// Errores por subscription quedan aislados — un fallo en una no detiene las
// otras. El run completo siempre responde 200; el detalle esta en el log.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''
const STRIPE_PLATFORM_SECRET_KEY = Deno.env.get('STRIPE_PLATFORM_SECRET_KEY') ?? ''
const DRY_RUN = Deno.env.get('BILLING_SYNC_DRY_RUN') === 'true'

interface SubscriptionRow {
  id: string
  company_id: string
  plan_id: string
  status: string
  stripe_subscription_id: string | null
}

interface PlanRow {
  id: string
  stripe_price_id_activation: string | null
  stripe_price_id_extra_project: string | null
  stripe_price_id_unit_primary: string | null
  stripe_price_id_unit_extra: string | null
}

interface UsageRow {
  extra_projects_count: number
  primary_units_count: number
  extra_units_count: number
}

interface SyncLogPayload {
  subscription_id: string | null
  company_id: string | null
  stripe_subscription_id: string | null
  outcome: 'noop' | 'updated' | 'skipped' | 'error'
  changes: Record<string, unknown> | null
  last_error: string | null
}

async function syncOne(
  sub: SubscriptionRow,
  supabase: ReturnType<typeof createClient>,
  stripe: Stripe,
): Promise<SyncLogPayload> {
  const base: SyncLogPayload = {
    subscription_id: sub.id,
    company_id: sub.company_id,
    stripe_subscription_id: sub.stripe_subscription_id,
    outcome: 'noop',
    changes: null,
    last_error: null,
  }

  if (!sub.stripe_subscription_id) {
    return { ...base, outcome: 'skipped', last_error: 'sin stripe_subscription_id' }
  }

  // 1. Plan + price ids
  const { data: planData, error: planErr } = await supabase
    .from('billing_plans')
    .select('id, stripe_price_id_activation, stripe_price_id_extra_project, stripe_price_id_unit_primary, stripe_price_id_unit_extra')
    .eq('id', sub.plan_id)
    .maybeSingle()

  if (planErr || !planData) {
    return { ...base, outcome: 'error', last_error: `plan no encontrado: ${planErr?.message ?? 'null'}` }
  }
  const plan = planData as PlanRow
  if (!plan.stripe_price_id_activation || !plan.stripe_price_id_extra_project ||
      !plan.stripe_price_id_unit_primary || !plan.stripe_price_id_unit_extra) {
    return { ...base, outcome: 'skipped', last_error: 'plan sin los 4 stripe_price_id configurados' }
  }
  const priceIds: PlanPriceIds = {
    activation:    plan.stripe_price_id_activation,
    unit_primary:  plan.stripe_price_id_unit_primary,
    extra_project: plan.stripe_price_id_extra_project,
    unit_extra:    plan.stripe_price_id_unit_extra,
  }

  // 2. Uso actual
  const { data: usageRows, error: usageErr } = await supabase
    .rpc('calculate_monthly_total_cents', { p_company_id: sub.company_id })
  if (usageErr) {
    return { ...base, outcome: 'error', last_error: `calculate_monthly_total_cents fallo: ${usageErr.message}` }
  }
  const usage = (usageRows as UsageRow[] | null)?.[0]
  if (!usage) {
    return { ...base, outcome: 'skipped', last_error: 'sin datos de usage' }
  }
  const expected = computeExpectedQuantities(usage)

  // 3. Stripe subscription + items
  let stripeSub: Stripe.Subscription
  try {
    stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id, { expand: ['items.data.price'] })
  } catch (e) {
    return { ...base, outcome: 'error', last_error: `stripe.retrieve fallo: ${(e as Error).message}` }
  }

  const items: StripeSubItem[] = stripeSub.items.data.map(it => ({
    id: it.id,
    price: { id: typeof it.price === 'string' ? it.price : it.price.id },
    quantity: it.quantity ?? 0,
  }))

  const ops = planSyncOps(items, expected, priceIds)
  if (ops.length === 0) {
    return { ...base, outcome: 'noop' }
  }

  // 4. Aplicar ops (o solo loguear si DRY_RUN)
  const changes: Record<string, { kind: SyncOp['kind']; from?: number; to?: number; price: string }> = {}
  let applyError: string | null = null

  for (const op of ops) {
    const key = nameForPrice(op.price, priceIds)
    if (DRY_RUN) {
      // Solo registra lo que haria.
      changes[key] = op.kind === 'add'
        ? { kind: op.kind, price: op.price, to: op.to }
        : op.kind === 'remove'
          ? { kind: op.kind, price: op.price, from: op.from }
          : { kind: op.kind, price: op.price, from: op.from, to: op.to }
      continue
    }

    try {
      if (op.kind === 'update') {
        await stripe.subscriptionItems.update(op.itemId, {
          quantity: op.to,
          proration_behavior: 'create_prorations',
        })
        changes[key] = { kind: 'update', price: op.price, from: op.from, to: op.to }
      } else if (op.kind === 'remove') {
        await stripe.subscriptionItems.del(op.itemId, { proration_behavior: 'create_prorations' })
        changes[key] = { kind: 'remove', price: op.price, from: op.from }
      } else if (op.kind === 'add') {
        await stripe.subscriptionItems.create({
          subscription: sub.stripe_subscription_id,
          price: op.price,
          quantity: op.to,
          proration_behavior: 'create_prorations',
        })
        changes[key] = { kind: 'add', price: op.price, to: op.to }
      }
    } catch (e) {
      applyError = `${op.kind} ${key} fallo: ${(e as Error).message}`
      break
    }
  }

  if (applyError) {
    return { ...base, outcome: 'error', changes, last_error: applyError }
  }
  return { ...base, outcome: 'updated', changes }
}

function nameForPrice(priceId: string, ids: PlanPriceIds): string {
  if (priceId === ids.activation)    return 'activation'
  if (priceId === ids.unit_primary)  return 'unit_primary'
  if (priceId === ids.extra_project) return 'extra_project'
  if (priceId === ids.unit_extra)    return 'unit_extra'
  return priceId
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Auth: solo el cron con CRON_SECRET puede invocar.
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!STRIPE_PLATFORM_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'STRIPE_PLATFORM_SECRET_KEY no configurado' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const stripe = new Stripe(STRIPE_PLATFORM_SECRET_KEY, { apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion })

  const { data: subs, error: subsErr } = await supabase
    .from('subscriptions')
    .select('id, company_id, plan_id, status, stripe_subscription_id')
    .in('status', ['trialing', 'active', 'past_due', 'incomplete'])
    .not('stripe_subscription_id', 'is', null)

  if (subsErr) {
    return new Response(JSON.stringify({ error: subsErr.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  const subRows = (subs ?? []) as SubscriptionRow[]
  const summary = { processed: subRows.length, noop: 0, updated: 0, skipped: 0, error: 0, dry_run: DRY_RUN }

  // Secuencial — Stripe rate-limits por API key y son pocas subs (decenas).
  for (const sub of subRows) {
    let logPayload: SyncLogPayload
    try {
      logPayload = await syncOne(sub, supabase, stripe)
    } catch (e) {
      logPayload = {
        subscription_id: sub.id,
        company_id: sub.company_id,
        stripe_subscription_id: sub.stripe_subscription_id,
        outcome: 'error',
        changes: null,
        last_error: `excepcion no manejada: ${(e as Error).message}`,
      }
    }
    summary[logPayload.outcome]++

    await supabase.from('billing_sync_log').insert({
      subscription_id: logPayload.subscription_id,
      company_id: logPayload.company_id,
      stripe_subscription_id: logPayload.stripe_subscription_id,
      outcome: logPayload.outcome,
      changes: logPayload.changes,
      last_error: logPayload.last_error,
    })
  }

  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  })
})
