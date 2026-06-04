// Lógica pura de invite-user, extraída del handler para poder testearla en
// aislamiento (infra:I22 · Track T8). Sin Deno ni supabase-js → corre directo en
// vitest. El handler (index.ts) importa estos símbolos: el comportamiento no cambia,
// solo se mueve la definición a un archivo importable desde los tests.

// Roles que un admin/owner puede otorgar por invitación. Espejo del whitelist de
// create-user (allowedRolesForNonSuper). NUNCA super_admin / company_owner.
export const INVITABLE_ROLES = ['admin', 'operator', 'operador', 'viewer', 'visor', 'collector']

// Etiqueta legible del rol para el correo (es-MX).
export const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador',
  operator: 'Operador',
  operador: 'Operador',
  viewer: 'Visualizador',
  visor: 'Visualizador',
  collector: 'Cobros',
}

// Vida de la invitación: 7 días.
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** `true` si `role` es invitable por un admin/owner (whitelist). */
export function isInvitableRole(role: string): boolean {
  return INVITABLE_ROLES.includes(role)
}

/** Etiqueta legible del rol; cae al propio rol si no hay mapeo. */
export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role
}

// Mismo regex de email que el handler (y signup-company): un arroba, un punto,
// sin espacios. Validación básica server-side; Supabase Auth valida de nuevo.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** `true` si el email tiene formato válido. */
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email)
}

/**
 * Token aleatorio seguro URL-safe (32 bytes → 43 chars base64url). Usa Web Crypto
 * (`crypto.getRandomValues`), disponible tanto en Deno como en Node 19+/jsdom, no
 * `Math.random`. Idéntico al del handler.
 */
export function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Calcula el instante de expiración (ISO) a partir de un `now` inyectable (ms).
 * Inyectable para que el test sea determinista sin tocar el reloj global.
 */
export function computeExpiresAt(nowMs: number = Date.now()): string {
  return new Date(nowMs + INVITATION_TTL_MS).toISOString()
}
