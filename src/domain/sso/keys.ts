// T3 · plat:P10 — Query keys del dominio SSO.
//
// Convención (igual que src/domain/cobros/keys.ts):
//   - `all`: raíz del dominio para invalidar todo de una vez.
//   - cada entidad añade su scope, normalizando ausente a `null` para que la key
//     sea estable entre renders.
export const ssoKeys = {
  all: ['sso'] as const,
  // Dominios SSO de un tenant (leídos por owner/admin vía RLS).
  domains: (companyId?: string) =>
    [...ssoKeys.all, 'domains', companyId ?? null] as const,
  // Descubrimiento PRE-login de un dominio (RPC anon-callable).
  lookup: (domain?: string) =>
    [...ssoKeys.all, 'lookup', (domain ?? '').trim().toLowerCase() || null] as const,
} as const
