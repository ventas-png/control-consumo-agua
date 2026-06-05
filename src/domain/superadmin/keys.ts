// Query keys del dominio Superadmin (plataforma).
//
// Convención (ver src/domain/README.md):
//   - `all`: raíz para invalidar todo el dominio.
//   - cada entidad añade su scope a la key. El listado de empresas se pagina/
//     busca server-side (plat:P14), así que search/limit/offset forman parte de
//     la key (cada página/búsqueda tiene su propia entrada en caché).
export const superadminKeys = {
  all: ['superadmin'] as const,
  plataformaKpis: () => [...superadminKeys.all, 'plataforma-kpis'] as const,
  empresas: (search?: string, limit?: number, offset?: number) =>
    [...superadminKeys.all, 'empresas', search ?? null, limit ?? null, offset ?? null] as const,
} as const
