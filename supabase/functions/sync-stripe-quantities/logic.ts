// Lógica pura de sync-stripe-quantities, extraída del handler para poder
// testearla en aislamiento (infra:I22 · Track T8/T5, issue #321). Sin Deno ni
// supabase-js ni stripe → corre directo en vitest.
//
// El cálculo central de quantities (computeExpectedQuantities) y el plan de
// operaciones (planSyncOps) ya viven en _shared/billingSync.ts con sus propios
// tests — aquí NO se duplican. Este módulo cubre lo propio de la función:
// normalizar los subscription_items crudos de Stripe al formato que espera
// planSyncOps, etiquetar cada price para el audit log (billing_sync_log) y
// serializar cada operación como entrada de `changes`.

import type { PlanPriceIds, StripeSubItem, SyncOp } from '../_shared/billingSync.ts'

/**
 * Item crudo tal como llega de stripe.subscriptions.retrieve: `price` puede
 * venir como string (id) o expandido como objeto; `quantity` puede faltar.
 */
export interface RawStripeItem {
  id: string
  price: string | { id: string }
  quantity?: number | null
}

/**
 * Normaliza los items de Stripe al formato de planSyncOps. quantity ausente →
 * 0 (así planSyncOps lo trata como "hay que actualizar/eliminar", nunca como
 * coincidencia silenciosa).
 */
export function toStripeSubItems(items: RawStripeItem[]): StripeSubItem[] {
  return items.map(it => ({
    id: it.id,
    price: { id: typeof it.price === 'string' ? it.price : it.price.id },
    quantity: it.quantity ?? 0,
  }))
}

/**
 * Nombre legible del componente para el audit log (billing_sync_log.changes).
 * Un price desconocido cae al propio priceId — nunca se pierde la traza de a
 * qué línea de dinero corresponde el cambio.
 */
export function nameForPrice(priceId: string, ids: PlanPriceIds): string {
  if (priceId === ids.activation)    return 'activation'
  if (priceId === ids.unit_primary)  return 'unit_primary'
  if (priceId === ids.extra_project) return 'extra_project'
  if (priceId === ids.unit_extra)    return 'unit_extra'
  return priceId
}

/**
 * Entrada de `changes` para una operación: update lleva from→to, add solo to,
 * remove solo from. Mismo formato en DRY_RUN y en aplicación real, así el log
 * es comparable entre ambos modos.
 */
export function describeSyncOp(op: SyncOp): { kind: SyncOp['kind']; from?: number; to?: number; price: string } {
  return op.kind === 'add'
    ? { kind: op.kind, price: op.price, to: op.to }
    : op.kind === 'remove'
      ? { kind: op.kind, price: op.price, from: op.from }
      : { kind: op.kind, price: op.price, from: op.from, to: op.to }
}
