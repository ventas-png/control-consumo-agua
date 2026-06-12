// Helpers puros del panel superadmin (testeables sin React).
//
// El modelo comercial es por MÓDULO ACTIVO + uso (proyectos/unidades), no por
// niveles: el badge de una empresa se deriva de sus flags de servicio y el
// código del billing plan solo se traduce a etiqueta legible.

/** Etiqueta del badge de módulos según los servicios activos de la empresa. */
export function moduleBadgeLabel(servicioAgua: boolean, servicioCondominios: boolean): string {
  if (servicioAgua && servicioCondominios) return 'Agua + Condominios'
  if (servicioAgua) return 'Agua'
  if (servicioCondominios) return 'Condominios'
  return 'Sin módulos'
}

/** Etiqueta legible del código de billing plan (agua_only/condominios_only/bundle). */
export function planCodeLabel(planCode: string | null): string {
  switch (planCode) {
    case 'agua_only': return 'Solo Agua'
    case 'condominios_only': return 'Solo Condominios'
    case 'bundle': return 'Bundle Completo'
    case null: return 'Sin suscripción'
    default: return planCode
  }
}

/** Período de gracia (días suspendida) antes de permitir la purga definitiva.
 *  Debe coincidir con DELETE_COMPANY_GRACE_DAYS del edge delete-company. */
export const DELETE_GRACE_DAYS = 90

/** Fecha en que la empresa será elegible para purga, o null si no está suspendida. */
export function purgeEligibleAt(suspendedAt: string | null, graceDays = DELETE_GRACE_DAYS): Date | null {
  if (!suspendedAt) return null
  const t = new Date(suspendedAt).getTime()
  if (Number.isNaN(t)) return null
  return new Date(t + graceDays * 24 * 60 * 60 * 1000)
}

/** true si la empresa ya cumplió el período de gracia y puede purgarse. */
export function isPurgeEligible(
  suspendedAt: string | null,
  graceDays = DELETE_GRACE_DAYS,
  now: Date = new Date(),
): boolean {
  const eligible = purgeEligibleAt(suspendedAt, graceDays)
  return eligible !== null && eligible <= now
}

/** Formato USD para cents ($1,234.56). */
export function formatUsdCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
