// Lógica pura de delete-user, extraída del handler para poder testearla en
// aislamiento (infra:I22 · Track T8/T5). Sin Deno ni supabase-js → corre directo
// en vitest. El handler (index.ts) importa estos símbolos: el comportamiento no
// cambia, solo se mueve la definición a un archivo importable desde los tests.

// Roles que un caller NO super_admin puede eliminar. Espejo de create-user
// (ALLOWED_ROLES_FOR_NON_SUPER): company_owner / admin gestionan estos niveles,
// pero nunca a otros owners ni superadmins.
export const DELETABLE_ROLES = ['admin', 'operator', 'operador', 'viewer', 'visor', 'collector']

/** `true` si el rol es super_admin (ambas grafías históricas). */
export function isSuperAdminRole(role: string): boolean {
  return role === 'super_admin' || role === 'superadmin'
}

/**
 * `true` si el rol del caller puede gestionar usuarios (crear/eliminar):
 * super_admin, company_owner o admin. Cualquier otro rol → 403 en el handler.
 */
export function canManageUsers(role: string): boolean {
  return isSuperAdminRole(role) || role === 'company_owner' || role === 'admin'
}

/** Fila mínima del usuario objetivo (lo que el handler lee de app_users). */
export interface TargetUserRow {
  id: string
  role: string
  company_id: string | null
  full_name: string
}

/** Resultado del gate de borrado: ok, o el mensaje exacto del 403 del handler. */
export type DeleteGate = { ok: true } | { ok: false; error: string }

/**
 * Gate de borrado para el usuario objetivo. super_admin puede borrar a
 * cualquiera; el resto (company_owner/admin) solo dentro de su propia empresa
 * y nunca a un owner/superadmin. El check de empresa va PRIMERO (mismo orden
 * que el handler): un owner de otra empresa produce el error de cross-tenant,
 * no el de rol.
 */
export function checkDeleteTargetGate(input: {
  isSuperAdmin: boolean
  callerCompanyId: string | null
  target: Pick<TargetUserRow, 'role' | 'company_id'>
}): DeleteGate {
  if (!input.isSuperAdmin) {
    if (input.target.company_id !== input.callerCompanyId) {
      return { ok: false, error: 'No puedes eliminar usuarios de otra empresa' }
    }
    if (!DELETABLE_ROLES.includes(input.target.role)) {
      return { ok: false, error: 'No tienes permiso para eliminar a este usuario' }
    }
  }
  return { ok: true }
}

/**
 * Fila de permission_audit_log tras el borrado. `target_user_id` es null a
 * propósito — la fila de app_users ya no existe (FK) — así que la identidad
 * se preserva en `details` en su lugar.
 */
export function buildUserDeletedAudit(
  callerId: string,
  targetId: string,
  target: TargetUserRow,
): {
  actor_id: string
  target_user_id: null
  action: string
  details: Record<string, unknown>
} {
  return {
    actor_id: callerId,
    target_user_id: null,
    action: 'user_deleted',
    details: {
      deleted_user_id: targetId,
      full_name: target.full_name,
      role: target.role,
      company_id: target.company_id,
    },
  }
}
