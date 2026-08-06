// Query keys del dominio Superadmin (plataforma).
//
// Convención (ver src/domain/README.md):
//   - `all`: raíz para invalidar todo el dominio.
//   - cada entidad añade su scope a la key. El listado de empresas se pagina/
//     busca/filtra server-side, así que search/limit/offset/status/module/sort
//     forman parte de la key (cada página/búsqueda tiene su propia entrada en
//     caché).
export const superadminKeys = {
  all: ['superadmin'] as const,
  plataformaKpis: () => [...superadminKeys.all, 'plataforma-kpis'] as const,
  empresas: (
    search?: string,
    limit?: number,
    offset?: number,
    status?: string,
    module?: string,
    sort?: string,
  ) =>
    [
      ...superadminKeys.all, 'empresas',
      search ?? null, limit ?? null, offset ?? null,
      status || null, module || null, sort ?? null,
    ] as const,
  trends: (months: number) => [...superadminKeys.all, 'trends', months] as const,
  mrrTrend: (days: number) => [...superadminKeys.all, 'mrr-trend', days] as const,
  trialCohortes: (months: number) =>
    [...superadminKeys.all, 'trial-cohortes', months] as const,
  empresaUsuarios: (companyId: string) =>
    [...superadminKeys.all, 'empresa-usuarios', companyId] as const,
  empresaBilling: (companyId: string) =>
    [...superadminKeys.all, 'empresa-billing', companyId] as const,
  empresaMoneda: (companyId: string) =>
    [...superadminKeys.all, 'empresa-moneda', companyId] as const,
  empresaComision: (companyId: string) =>
    [...superadminKeys.all, 'empresa-comision', companyId] as const,
  empresaComisionResumen: (companyId: string) =>
    [...superadminKeys.all, 'empresa-comision-resumen', companyId] as const,
  empresaTimbrado: (companyId: string) =>
    [...superadminKeys.all, 'empresa-timbrado', companyId] as const,
  empresaTimbresResumen: (companyId: string) =>
    [...superadminKeys.all, 'empresa-timbres-resumen', companyId] as const,
} as const
