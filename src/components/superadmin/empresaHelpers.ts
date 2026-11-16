// Helpers puros del panel superadmin (testeables sin React).
//
// El modelo comercial es por MÓDULO ACTIVO + uso (proyectos/unidades), no por
// niveles: el badge de una empresa se deriva de sus flags de servicio y el
// código del billing plan solo se traduce a etiqueta legible.

/** Etiqueta del badge de módulos según los servicios activos de la empresa. */
export function moduleBadgeLabel(servicioAgua: boolean, servicioCondominios: boolean, servicioRentas = false): string {
  const modulos = [servicioAgua && 'Agua', servicioCondominios && 'Condominios', servicioRentas && 'Rentas'].filter(Boolean)
  return modulos.length > 0 ? modulos.join(' + ') : 'Sin módulos'
}

/**
 * Código del billing plan que corresponde a una combinación de módulos, o null
 * si no hay ninguno. ESPEJO de la función SQL `plan_code_por_modulos`
 * (migración 20261126000000): 1 módulo $10, 2 módulos $15, 3 módulos $20.
 */
export function planCodePorModulos(agua: boolean, condominios: boolean, rentas: boolean): string | null {
  if (agua && condominios && rentas) return 'suite'
  if (agua && condominios) return 'bundle'
  if (agua && rentas) return 'agua_rentas'
  if (condominios && rentas) return 'condominios_rentas'
  if (agua) return 'agua_only'
  if (condominios) return 'condominios_only'
  if (rentas) return 'rentas_only'
  return null
}

/** Etiqueta legible del código de billing plan (los tres de siempre + las combinaciones con Rentas). */
export function planCodeLabel(planCode: string | null): string {
  switch (planCode) {
    case 'agua_only': return 'Solo Agua'
    case 'condominios_only': return 'Solo Condominios'
    case 'bundle': return 'Bundle Completo'
    case 'rentas_only': return 'Solo Rentas'
    case 'agua_rentas': return 'Agua + Rentas'
    case 'condominios_rentas': return 'Condominios + Rentas'
    case 'suite': return 'Suite Completa'
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
