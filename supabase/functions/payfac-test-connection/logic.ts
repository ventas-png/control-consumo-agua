// Lógica pura de payfac-test-connection, extraída del handler para poder
// testearla en aislamiento (infra:I22 · Track T8/T5). Sin Deno ni supabase-js →
// corre directo en vitest (solo importa TIPOS de _shared/payments, que ya es
// puro). El handler (index.ts) importa estos símbolos: el comportamiento no
// cambia, solo se mueve la definición a un archivo importable desde los tests.
//
// El ping al provider y el resolver de config efectiva ya están cubiertos en
// _shared/payments/__tests__ — aquí solo la lógica PROPIA del handler: parseo
// del ambiente, lectura segura de credenciales de la bóveda, resolución del
// tenant y gate multi-tenant.

import type { AmbientePago } from '../_shared/payments/index.ts'

/** Ambiente a probar: SOLO el literal 'prod' activa prod; todo lo demás → sandbox. */
export function parseAmbiente(v: unknown): AmbientePago {
  return v === 'prod' ? 'prod' : 'sandbox'
}

/** Lee las credenciales del ambiente desde la fila de la bóveda (jsonb opaco). */
export function credsDeAmbiente(
  credenciales: unknown,
  ambiente: AmbientePago,
): Record<string, unknown> | null {
  if (typeof credenciales !== 'object' || credenciales === null) return null
  const v = (credenciales as Record<string, unknown>)[ambiente]
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

/**
 * Tenant efectivo de la prueba: la empresa del PROYECTO (autoritativa cuando
 * viene project_id) → la del body → la del llamante. Igual que el handler.
 */
export function resolverCompanyId(
  projectCompanyId: string | null,
  bodyCompanyId: string | null | undefined,
  callerCompanyId: string | null,
): string | null {
  return projectCompanyId ?? bodyCompanyId ?? callerCompanyId ?? null
}

/**
 * Gate multi-tenant: service_role (interno) y super_admin prueban cualquier
 * tenant; un admin/owner SOLO el suyo. Espeja la condición del handler
 * (`!internal && !callerIsSuperAdmin && callerCompanyId !== companyId`).
 */
export function autorizadoParaTenant(
  internal: boolean,
  callerIsSuperAdmin: boolean,
  callerCompanyId: string | null,
  companyId: string,
): boolean {
  return internal || callerIsSuperAdmin || callerCompanyId === companyId
}
