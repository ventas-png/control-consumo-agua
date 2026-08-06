// Lógica pura de delete-company, extraída del handler para poder testearla en
// aislamiento (infra:I22 · Track T8/T5). Sin Deno, supabase-js ni stripe → corre
// directo en vitest. El handler (index.ts) importa estos símbolos: el
// comportamiento no cambia, solo se mueve la decisión a un archivo importable.
//
// El handler mezcla I/O (queries, Stripe, storage) con las decisiones de la
// purga; aquí vive SOLO la parte pura: gates de confirmación/gracia, la
// clasificación del error de Stripe, la partición de usuarios (super_admins se
// desligan, el resto se purga) y el snapshot de auditoría.

export const DEFAULT_GRACE_DAYS = 90

/** `true` si el rol es super_admin (ambas grafías históricas). */
export function isSuperAdminRole(role: string): boolean {
  return role === 'super_admin' || role === 'superadmin'
}

/**
 * Días de gracia efectivos: entero del env DELETE_COMPANY_GRACE_DAYS, o el
 * default (90) si no está definido / no parsea / es 0.
 */
export function resolveGraceDays(raw: string | null | undefined): number {
  return parseInt(raw ?? '', 10) || DEFAULT_GRACE_DAYS
}

/** Fila de companies que el handler lee antes de la purga. */
export interface CompanyRow {
  id: string
  nombre: string
  activa: boolean
  suspended_at: string | null
  suspended_reason: string | null
  logo_url: string | null
  created_at: string | null
}

/** Resultado de los gates: ok, o el status + mensaje exactos del handler. */
export type PurgeGate = { ok: true } | { ok: false; status: number; error: string }

/**
 * Gates de confirmación previos a la purga, en el MISMO orden del handler:
 *   1. confirm_name debe coincidir EXACTO (case-sensitive) con companies.nombre → 400.
 *   2. La empresa debe estar suspendida (activa=false) → 409.
 *   3. Deben haber pasado >= graceDays días desde suspended_at → 409 (con la
 *      fecha elegible si suspended_at existe).
 * `now` inyectable para que el test sea determinista.
 */
export function checkPurgeGates(
  company: Pick<CompanyRow, 'nombre' | 'activa' | 'suspended_at'>,
  confirmName: string,
  graceDays: number,
  now: Date = new Date(),
): PurgeGate {
  if (confirmName !== company.nombre) {
    return { ok: false, status: 400, error: 'El nombre de confirmación no coincide con el nombre de la empresa' }
  }
  if (company.activa) {
    return { ok: false, status: 409, error: 'La empresa debe estar suspendida antes de eliminarse' }
  }
  const suspendedAt = company.suspended_at ? new Date(company.suspended_at) : null
  const graceEnds = suspendedAt ? new Date(suspendedAt.getTime() + graceDays * 24 * 60 * 60 * 1000) : null
  if (!suspendedAt || !graceEnds || graceEnds > now) {
    return {
      ok: false,
      status: 409,
      error: `La empresa debe llevar al menos ${graceDays} días suspendida antes de la purga definitiva` +
        (graceEnds ? ` (elegible el ${graceEnds.toISOString().slice(0, 10)})` : ''),
    }
  }
  return { ok: true }
}

/**
 * `true` si el fallo al cancelar la suscripción en Stripe es benigno (ya
 * cancelada / inexistente) y la purga puede continuar. Cualquier otro fallo
 * aborta para no dejar un cobro recurrente huérfano.
 */
export function isBenignStripeCancelError(msg: string): boolean {
  return /No such subscription|canceled/i.test(msg)
}

/** Fila mínima de app_users de la empresa (lo que lee el handler). */
export interface CompanyUser {
  id: string
  role: string
  full_name: string | null
}

/**
 * Particiona los usuarios de la empresa: un super_admin nunca debería colgar
 * de un tenant — si ocurre, se le desliga (company_id=null) en vez de
 * eliminarlo junto con la empresa. El resto (incluido company_owner) se purga.
 */
export function partitionCompanyUsers(users: CompanyUser[]): {
  superAdmins: CompanyUser[]
  deletables: CompanyUser[]
} {
  return {
    superAdmins: users.filter(u => u.role === 'super_admin' || u.role === 'superadmin'),
    deletables: users.filter(u => u.role !== 'super_admin' && u.role !== 'superadmin'),
  }
}

/**
 * Snapshot `before` para audit_log — es lo ÚNICO que sobrevive al DELETE de la
 * empresa, así que preserva la fila completa + conteos + parámetros de la purga.
 * Los counts pueden llegar null (head:true sin filas) → 0.
 */
export function buildPurgeAuditBefore(
  company: CompanyRow,
  counts: { projects: number | null; unidades: number | null; usuarios: number },
  graceDays: number,
  stripeSubId: string | null,
): Record<string, unknown> {
  return {
    ...company,
    deleted_counts: {
      projects: counts.projects ?? 0,
      unidades: counts.unidades ?? 0,
      usuarios: counts.usuarios,
    },
    grace_days: graceDays,
    stripe_subscription_canceled: stripeSubId,
  }
}
