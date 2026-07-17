// Cobros pluggable (payfac) — Query keys del dominio.
//
// Convención (igual que src/domain/fiscal/keys.ts):
//   - `all`: raíz del dominio para invalidar todo de una vez.
//   - cada entidad añade su scope (companyId/projectId), normalizando ausente a
//     `null` para que la key sea estable entre renders.
//
// Namespace propio ('payfac') para no colisionar con otras keys de cobros.
export const payfacKeys = {
  all: ['payfac'] as const,
  // Config de pago EFECTIVA de una locación (override resuelto vs empresa).
  configEfectiva: (companyId?: string, projectId?: string) =>
    [...payfacKeys.all, 'config-efectiva', companyId ?? null, projectId ?? null] as const,
  // Estatus (NO sensible) de credenciales del payfac de un tenant.
  estatus: (companyId?: string) =>
    [...payfacKeys.all, 'estatus', companyId ?? null] as const,
  // Aging + score de morosidad por unidad (RPC cartera_morosidad).
  morosidad: (companyId?: string, projectId?: string | null) =>
    [...payfacKeys.all, 'cartera-morosidad', companyId ?? null, projectId ?? null] as const,
} as const
