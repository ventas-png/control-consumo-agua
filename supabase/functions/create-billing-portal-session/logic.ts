// Lógica pura de create-billing-portal-session, extraída del handler para
// poder testearla en aislamiento (infra:I22 · Track T8/T5, issue #321). Sin
// Deno ni supabase-js ni stripe → corre directo en vitest.
//
// NOTA: estas funciones son una copia local idéntica a las de
// create-checkout-session/logic.ts porque el código original ya duplicaba el
// bloque CORS/rol por función (las edge fns solo comparten vía _shared/, que
// está fuera del alcance de esta extracción mecánica). Se testean por separado
// porque son código separado: un drift entre copias es exactamente el bug que
// estos tests cazarían.

// Roles que pueden abrir el billing portal (cambiar plan, cancelar, tarjeta).
export const BILLING_MANAGER_ROLES = ['company_owner', 'admin']

/** `true` si `role` puede abrir el Stripe Billing Portal de su company. */
export function canManageBilling(role: string): boolean {
  return BILLING_MANAGER_ROLES.includes(role)
}
