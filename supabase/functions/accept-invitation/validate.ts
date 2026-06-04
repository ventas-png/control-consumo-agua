// Lógica pura de accept-invitation, extraída del handler para testearla en
// aislamiento (infra:I22 · Track T8). Sin Deno ni supabase-js → corre en vitest.
// El handler (index.ts) importa estos símbolos; el comportamiento no cambia.

/**
 * Validación de fortaleza de contraseña (server-side). Misma regla que
 * validatePasswordStrength del frontend: ≥8 chars, ≥1 mayúscula, ≥1 minúscula,
 * ≥1 número. Devuelve el mensaje de error (es-MX) o `null` si es válida.
 */
export function validatePassword(pw: string): string | null {
  if (!pw || pw.length < 8) return 'La contraseña debe tener al menos 8 caracteres'
  if (!/[A-Z]/.test(pw)) return 'La contraseña debe incluir al menos una mayúscula'
  if (!/[a-z]/.test(pw)) return 'La contraseña debe incluir al menos una minúscula'
  if (!/\d/.test(pw)) return 'La contraseña debe incluir al menos un número'
  return null
}

// Mapa rol → role_id de plataforma (RBAC). Espejo EXACTO del de create-user
// (migración 20260518000013_rbac_platform_modules.sql).
export const PLATFORM_ROLE_ID: Record<string, string> = {
  admin:     '00000000-0000-0000-0000-000000000201',
  operator:  '00000000-0000-0000-0000-000000000202',
  operador:  '00000000-0000-0000-0000-000000000202',
  viewer:    '00000000-0000-0000-0000-000000000203',
  visor:     '00000000-0000-0000-0000-000000000203',
  collector: '00000000-0000-0000-0000-000000000204',
}

/** role_id de plataforma para el rol, o `undefined` si el rol bypassa RBAC. */
export function platformRoleId(role: string): string | undefined {
  return PLATFORM_ROLE_ID[role]
}

export interface InvitationStatusCheck {
  /** Estado actual de la invitación (pending | accepted | expired | revoked | …). */
  status: string
  /** Expiración ISO de la invitación. */
  expiresAt: string
}

/**
 * Resultado de evaluar si una invitación es utilizable. `ok: true` → se puede
 * proceder a aceptar. `ok: false` → el handler debe responder con `status` y `error`.
 *
 * Modela el corto-circuito del handler como datos puros (idempotencia: un token
 * ya 'accepted' devuelve 409, no re-crea cuenta; uno expirado → 410).
 */
export type InvitationGate =
  | { ok: true }
  | { ok: false; status: number; error: string; markExpired: boolean }

/**
 * Decide si la invitación puede usarse. `nowMs` inyectable para test determinista.
 *   - status != 'pending'  → 409 (ya usada / no disponible). Idempotente.
 *   - expirada             → 410 + flag para marcarla 'expired' (best-effort).
 *   - pending y vigente    → ok.
 */
export function checkInvitationUsable(
  inv: InvitationStatusCheck,
  nowMs: number = Date.now(),
): InvitationGate {
  if (inv.status !== 'pending') {
    const error = inv.status === 'accepted'
      ? 'Esta invitación ya fue utilizada.'
      : 'Esta invitación ya no está disponible.'
    return { ok: false, status: 409, error, markExpired: false }
  }
  if (new Date(inv.expiresAt).getTime() < nowMs) {
    return { ok: false, status: 410, error: 'Esta invitación expiró. Pide una nueva.', markExpired: true }
  }
  return { ok: true }
}

/**
 * Clasifica el error de `auth.admin.createUser` como "email ya existe" (→ 409)
 * para distinguirlo de un fallo genérico (→ 500). Espejo de la heurística del
 * handler (busca 'already' / 'exists' / 'registered' en el mensaje).
 */
export function isDuplicateUserError(message: string | null | undefined): boolean {
  const m = (message ?? '').toLowerCase()
  return m.includes('already') || m.includes('exists') || m.includes('registered')
}
