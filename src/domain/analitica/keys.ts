// analitica (C1) — Query keys de la capa analítica del tenant (KPIs mensuales
// desde la MV kpis_tenant_mensual vía RPC). Convención src/domain/README.md.
export const analiticaKeys = {
  all: ['analitica'] as const,
  /** KPIs mensuales del tenant por rango [desde,hasta] (+ proyecto opcional). */
  kpisMensuales: (companyId?: string, desde?: string, hasta?: string, projectId?: string | null) =>
    [...analiticaKeys.all, 'kpis-mensuales', companyId ?? null, desde ?? null, hasta ?? null, projectId ?? null] as const,
}
