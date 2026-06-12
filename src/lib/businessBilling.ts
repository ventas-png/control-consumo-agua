// Lógica PURA del cobro por uso de la plataforma (espejo TS de la RPC
// calculate_monthly_total_cents, migración 20260528000060):
//
//   total = base_activation
//         + max(0, proyectos - 1) × extra_project
//         + unidades_primary × unit_primary
//         + unidades_extra   × unit_extra
//
// Sin I/O, sin React: solo funciones testeables. Usada por el modal de
// ampliación de límites para proyectar el costo mensual.

/** Componentes de precio del billing plan activo (cents). */
export interface PlanPricingCents {
  base_activation_cents: number
  extra_project_cents: number
  unit_primary_cents: number
  unit_extra_cents: number
  /** Topes del plan (techo del autoservicio). NULL = sin tope. */
  max_projects: number | null
  max_units: number | null
}

/** Total mensual en cents para una combinación de uso (misma aritmética que la BD). */
export function estimarTotalMensualCents(
  pricing: Pick<PlanPricingCents, 'base_activation_cents' | 'extra_project_cents' | 'unit_primary_cents' | 'unit_extra_cents'>,
  proyectos: number,
  unidadesPrimary: number,
  unidadesExtra: number,
): number {
  const extraProjects = Math.max(0, proyectos - 1)
  return (
    pricing.base_activation_cents +
    extraProjects * pricing.extra_project_cents +
    Math.max(0, unidadesPrimary) * pricing.unit_primary_cents +
    Math.max(0, unidadesExtra) * pricing.unit_extra_cents
  )
}

/**
 * Proyección del total mensual si la empresa usara TODO el límite solicitado.
 * Supuesto documentado en la UI: las unidades por encima de las primarias
 * actuales se estiman a la tarifa de proyectos adicionales (unit_extra);
 * con 1 solo proyecto, todas son primarias.
 */
export function proyectarTotalConLimitesCents(
  pricing: Pick<PlanPricingCents, 'base_activation_cents' | 'extra_project_cents' | 'unit_primary_cents' | 'unit_extra_cents'>,
  limiteProyectos: number,
  limiteUnidades: number,
  unidadesPrimaryActuales: number,
): number {
  const primary = limiteProyectos <= 1
    ? limiteUnidades
    : Math.min(limiteUnidades, Math.max(0, unidadesPrimaryActuales))
  const extra = Math.max(0, limiteUnidades - primary)
  return estimarTotalMensualCents(pricing, limiteProyectos, primary, extra)
}
