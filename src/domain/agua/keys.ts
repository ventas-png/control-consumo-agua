// T7 — Query keys del dominio Agua.
//
// Convención (replicable en cada dominio):
//   - `all`: raíz del dominio. Permite invalidar todo de una:
//       queryClient.invalidateQueries({ queryKey: aguaKeys.all })
//   - cada entidad es una función que añade el scope relevante (companyId) para
//     que cada tenant tenga su propia entrada en caché y no haya cross-leak.
//   - companyId ausente se normaliza a `null` para que la key sea estable
//     (`undefined` rompería la igualdad estructural entre renders).
export const aguaKeys = {
  all: ['agua'] as const,
  clientes: (companyId?: string) => [...aguaKeys.all, 'clientes', companyId ?? null] as const,
  registros: (companyId?: string) => [...aguaKeys.all, 'registros', companyId ?? null] as const,
  rutas: (companyId?: string) => [...aguaKeys.all, 'rutas', companyId ?? null] as const,
} as const
