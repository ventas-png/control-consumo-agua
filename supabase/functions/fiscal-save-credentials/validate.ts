// Lógica pura de fiscal-save-credentials, extraída del handler para poder
// testearla en aislamiento (infra:I22 · Track T8/T5). Sin Deno ni supabase-js →
// corre directo en vitest. El handler (index.ts) importa estos símbolos: el
// comportamiento no cambia, solo se mueve la definición a un archivo importable.
//
// Aquí vive SOLO la decisión pura sobre la bóveda fiscal_pac_secrets:
// validación del payload de credenciales por ambiente, resolución del tenant,
// gate de autorización por tenant y el MERGE que preserva el ambiente no
// enviado. El I/O (auth, queries, upsert) queda en index.ts. El secreto jamás
// sale de aquí hacia el cliente: estas funciones solo deciden, no responden.

/** Credenciales de un ambiente: objeto opaco (usuario/clave/token/cert, según PAC). */
export type CredencialesAmbiente = Record<string, unknown>

/** ¿Es un objeto plano (no array/null) usable como credenciales de ambiente? */
export function esObjeto(v: unknown): v is CredencialesAmbiente {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** ¿El ambiente trae credenciales? Objeto plano con al menos una clave. */
export function tieneCredenciales(v: unknown): v is CredencialesAmbiente {
  return esObjeto(v) && Object.keys(v).length > 0
}

/**
 * Proveedor a persistir: snapshot informativo de a qué PAC pertenecen las
 * credenciales. Trim; vacío/ausente cae a 'sandbox' (mismo default del handler).
 */
export function normalizarProveedor(raw: string | undefined): string {
  return (raw ?? '').trim() || 'sandbox'
}

/**
 * Resuelve el tenant dueño de las credenciales con la precedencia del handler:
 * la empresa del proyecto (autoritativa si vino project_id) → company_id del
 * body → company_id del JWT del llamante → null (el handler responde 400).
 */
export function resolverCompanyId(
  projectCompanyId: string | null,
  bodyCompanyId: string | null | undefined,
  callerCompanyId: string | null,
): string | null {
  return projectCompanyId ?? bodyCompanyId ?? callerCompanyId ?? null
}

/**
 * Gate de tenant: interno (service_role) y super_admin pasan siempre; un
 * admin/owner solo puede escribir credenciales de SU propia empresa.
 */
export function autorizadoParaTenant(
  auth: { internal: boolean; callerIsSuperAdmin: boolean; callerCompanyId: string | null },
  companyId: string,
): boolean {
  return auth.internal || auth.callerIsSuperAdmin || auth.callerCompanyId === companyId
}

/**
 * MERGE de credenciales por ambiente: parte de lo ya guardado y solo pisa el
 * ambiente que SÍ viene con credenciales no vacías (omitir un ambiente lo
 * preserva; mandar {} o null NO lo borra). No muta `actuales`.
 */
export function mergeCredenciales(
  actuales: Record<string, unknown>,
  sandbox: unknown,
  prod: unknown,
): Record<string, unknown> {
  const nuevas: Record<string, unknown> = { ...actuales }
  if (tieneCredenciales(sandbox)) nuevas.sandbox = sandbox
  if (tieneCredenciales(prod)) nuevas.prod = prod
  return nuevas
}
