// T4 / cond:C4 — Query keys del dominio Condominios (sub-dominio Cuotas).
//
// Convención (igual que src/domain/agua/keys.ts y src/domain/cobros/keys.ts):
//   - `all`: raíz del dominio para invalidar todo de una vez:
//       queryClient.invalidateQueries({ queryKey: condominiosKeys.all })
//   - cada entidad/lectura añade su scope (companyId / projectId), normalizando
//     ausente a `null` para que la key sea estable entre renders (`undefined`
//     rompería la igualdad estructural).
export const condominiosKeys = {
  all: ['condominios'] as const,
  // Cuotas con estado/mora (agregado Cuota) — lista por empresa.
  cuotas: (companyId?: string) =>
    [...condominiosKeys.all, 'cuotas', companyId ?? null] as const,
  // Cuotas de un proyecto concreto (scope company + proyecto).
  cuotasPorProyecto: (companyId?: string, projectId?: string) =>
    [...condominiosKeys.all, 'cuotas', 'por-proyecto', companyId ?? null, projectId ?? null] as const,
  // Recargos de mora (ledger recargos_mora) por empresa.
  recargosMora: (companyId?: string) =>
    [...condominiosKeys.all, 'recargos-mora', companyId ?? null] as const,
} as const
