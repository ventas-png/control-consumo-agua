// Lógica pura para sync de quantities a Stripe (F2.15d). Vive separada del
// edge function para que vitest pueda probarla sin levantar Stripe ni Deno.

// El RPC calculate_monthly_total_cents devuelve el desglose esperado por
// componente. Lo convertimos al formato que Stripe entiende (quantity por
// price_id).
export interface UsageBreakdown {
  // Numero de proyectos adicionales (despues del primario). 0 si solo hay 1.
  extra_projects_count: number
  // Unidades del proyecto primario. >= 0.
  primary_units_count: number
  // Unidades en proyectos adicionales. >= 0.
  extra_units_count: number
}

// Mapping de cada componente a su stripe_price_id. Estos vienen de la fila
// billing_plans correspondiente al plan_id de la subscription.
export interface PlanPriceIds {
  activation: string
  unit_primary: string
  extra_project: string
  unit_extra: string
}

// Quantities calculadas — formato que matchea con el line_items array que el
// checkout original creo. activation siempre es 1; los otros 3 reflejan el
// uso actual.
export interface ExpectedQuantities {
  activation: number
  unit_primary: number
  extra_project: number
  unit_extra: number
}

// Stripe subscription_item — solo nos interesan id, price.id y quantity.
export interface StripeSubItem {
  id: string
  price: { id: string }
  quantity: number
}

export function computeExpectedQuantities(usage: UsageBreakdown): ExpectedQuantities {
  return {
    activation: 1,
    // Stripe pide quantity >= 1 en el item primary aunque la company todavia
    // no haya creado unidades. La cuenta empieza en 1.
    unit_primary: Math.max(1, usage.primary_units_count),
    extra_project: Math.max(0, usage.extra_projects_count),
    unit_extra: Math.max(0, usage.extra_units_count),
  }
}

// Determina que items necesitan update + cuales hay que add/remove. Devuelve
// una lista de operaciones para que el edge function las aplique en orden.
// Pura — no llama a Stripe.
export type SyncOp =
  | { kind: 'update'; itemId: string; price: string; from: number; to: number }
  // 'remove' = item existe en Stripe pero ya no debe estar (quantity llegaria
  // a 0; Stripe no acepta quantity=0, hay que eliminar el item con deleted=true).
  | { kind: 'remove'; itemId: string; price: string; from: number }
  // 'add' = item no existe en Stripe (porque al checkout original tenia 0 y
  // se omitio) pero ahora debe estar.
  | { kind: 'add'; price: string; to: number }

export function planSyncOps(
  items: StripeSubItem[],
  expected: ExpectedQuantities,
  priceIds: PlanPriceIds,
): SyncOp[] {
  const ops: SyncOp[] = []

  // Helper: busca el item de Stripe que matchea un price_id particular.
  const findByPrice = (priceId: string) => items.find(it => it.price.id === priceId)

  // Componente por componente.
  const components: Array<{ key: keyof ExpectedQuantities; priceField: keyof PlanPriceIds }> = [
    { key: 'activation',    priceField: 'activation' },
    { key: 'unit_primary',  priceField: 'unit_primary' },
    { key: 'extra_project', priceField: 'extra_project' },
    { key: 'unit_extra',    priceField: 'unit_extra' },
  ]

  for (const { key, priceField } of components) {
    const wanted = expected[key]
    const priceId = priceIds[priceField]
    const existing = findByPrice(priceId)

    if (existing) {
      if (wanted === 0) {
        ops.push({ kind: 'remove', itemId: existing.id, price: priceId, from: existing.quantity })
      } else if (existing.quantity !== wanted) {
        ops.push({ kind: 'update', itemId: existing.id, price: priceId, from: existing.quantity, to: wanted })
      }
    } else if (wanted > 0) {
      ops.push({ kind: 'add', price: priceId, to: wanted })
    }
  }

  return ops
}

// ── Cambio de plan (P0 #1) ──────────────────────────────────────────────────
// Item para `stripe.subscriptions.update({ items: [...] })`. A diferencia de
// planSyncOps (mismo plan, solo ajusta cantidades), aquí los price_id CAMBIAN:
// hay que mover la subscription del set de precios viejo al nuevo en una sola
// llamada atómica, SIN dejar items huérfanos del plan anterior (que seguirían
// cobrándose → doble cobro, justo el bug que arreglamos).
export type SwapItem =
  // Reutilizar un item existente: fijar price (nuevo) + quantity.
  | { id: string; price: string; quantity: number }
  // Eliminar un item que ya no aplica (precio viejo, huérfano o duplicado).
  | { id: string; deleted: true }
  // Agregar un componente que la subscription aún no tiene.
  | { price: string; quantity: number }

// Construye el array `items` para subscriptions.update que deja la subscription
// EXACTAMENTE con los precios del nuevo plan a las cantidades esperadas.
//
// Solo depende de `newPriceIds` (no del plan viejo) → robusto ante:
//   - drift del plan viejo en BD,
//   - reintentos (si el swap ya se aplicó parcialmente, converge sin duplicar),
//   - planes que comparten un precio en algún componente (no genera churn).
//
// Estrategia: todo item que ya esté en un precio del nuevo plan se conserva (y
// se le ajusta la cantidad); cualquier otro item se elimina; los componentes
// del nuevo plan sin item se agregan.
//
// Precondición del modelo de pricing: los 4 precios de un plan son distintos
// entre sí y cada price_id representa un único componente. activation y
// unit_primary siempre quedan con quantity>=1 (computeExpectedQuantities), así
// que la subscription nunca queda sin items tras el swap.
export function planSwapItems(
  items: StripeSubItem[],
  expected: ExpectedQuantities,
  newPriceIds: PlanPriceIds,
): SwapItem[] {
  const ops: SwapItem[] = []
  const roles: Array<keyof ExpectedQuantities & keyof PlanPriceIds> = [
    'activation', 'unit_primary', 'extra_project', 'unit_extra',
  ]

  // 1. Para cada componente, el primer item que YA está en el precio nuevo se
  //    conserva ("survivor"): evita churn cuando dos planes comparten precio o
  //    ante un reintento donde el swap ya se había aplicado.
  const survivorByRole = new Map<string, StripeSubItem>()
  const survivorIds = new Set<string>()
  for (const role of roles) {
    const np = newPriceIds[role]
    const hit = items.find(it => it.price.id === np && !survivorIds.has(it.id))
    if (hit) {
      survivorByRole.set(role, hit)
      survivorIds.add(hit.id)
    }
  }

  // 2. Cualquier item que no sea survivor (precio del plan viejo, huérfano o
  //    duplicado del mismo precio) se elimina.
  for (const it of items) {
    if (!survivorIds.has(it.id)) ops.push({ id: it.id, deleted: true })
  }

  // 3. Ajustar cada componente a la cantidad esperada del nuevo plan.
  for (const role of roles) {
    const qty = expected[role]
    const np = newPriceIds[role]
    const survivor = survivorByRole.get(role)
    if (qty > 0) {
      if (survivor) {
        // Ya está en el precio nuevo; solo corrige la cantidad si difiere.
        if (survivor.quantity !== qty) ops.push({ id: survivor.id, price: np, quantity: qty })
      } else {
        ops.push({ price: np, quantity: qty })
      }
    } else if (survivor) {
      // El componente no aplica pero había un item en el precio nuevo → quitarlo.
      ops.push({ id: survivor.id, deleted: true })
    }
  }

  return ops
}
