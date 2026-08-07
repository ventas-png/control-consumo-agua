// Lógica pura de payfac-save-credentials, extraída del handler para poder
// testearla en aislamiento (infra:I22 · Track T8/T5). Sin Deno ni supabase-js →
// corre directo en vitest. El handler (index.ts) importa estos símbolos: el
// comportamiento no cambia, solo se mueve la definición a un archivo importable.
//
// La bóveda payfac_secrets es DENY-ALL bajo RLS y guarda credenciales por
// ambiente (sandbox/prod): los invariantes que se blindan aquí son el MERGE por
// ambiente (omitir un ambiente lo PRESERVA — nunca pisar prod al guardar
// sandbox), la resolución del tenant (project autoritativo) y el gate
// multi-tenant (admin/owner solo su empresa; service_role y super_admin pasan).

/** Credenciales de un ambiente: objeto opaco (x_login/x_api_key/… según payfac). */
export type CredencialesAmbiente = Record<string, unknown>

export function esObjeto(v: unknown): v is CredencialesAmbiente {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** `true` si el valor es un objeto de credenciales NO vacío (lo que exige el 400). */
export function tieneCredenciales(v: unknown): v is CredencialesAmbiente {
  return esObjeto(v) && Object.keys(v).length > 0
}

/** Normaliza el proveedor: trim + minúsculas; vacío/omitido → 'sandbox'. */
export function normalizarProveedor(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase() || 'sandbox'
}

/**
 * Tenant efectivo del guardado: la empresa del PROYECTO (autoritativa cuando
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
 * Gate multi-tenant: service_role (interno) y super_admin operan sobre cualquier
 * tenant; un admin/owner SOLO sobre su propia empresa. Espeja la condición del
 * handler (`!internal && !callerIsSuperAdmin && callerCompanyId !== companyId`).
 */
export function autorizadoParaTenant(
  internal: boolean,
  callerIsSuperAdmin: boolean,
  callerCompanyId: string | null,
  companyId: string,
): boolean {
  return internal || callerIsSuperAdmin || callerCompanyId === companyId
}

/**
 * MERGE por ambiente contra lo ya guardado: solo se reemplazan los ambientes que
 * vienen con credenciales no vacías; el resto de la bóveda se preserva tal cual.
 */
export function mergeCredenciales(
  credActuales: Record<string, unknown>,
  sandbox: CredencialesAmbiente | null | undefined,
  prod: CredencialesAmbiente | null | undefined,
): Record<string, unknown> {
  const nuevasCredenciales: Record<string, unknown> = { ...credActuales }
  if (tieneCredenciales(sandbox)) nuevasCredenciales.sandbox = sandbox
  if (tieneCredenciales(prod)) nuevasCredenciales.prod = prod
  return nuevasCredenciales
}
