// Lógica pura de invite-user, extraída del handler para poder testearla en
// aislamiento (infra:I22 · Track T8). Sin Deno ni supabase-js → corre directo en
// vitest. El handler (index.ts) importa estos símbolos: el comportamiento no cambia,
// solo se mueve la definición a un archivo importable desde los tests.

// Universo de roles que se pueden otorgar por invitación. Espejo del whitelist de create-user
// (ALLOWED_ROLES_FOR_NON_SUPER). NUNCA super_admin / company_owner. QUIÉN puede invitar a cada uno lo
// decide canInviteRole(): el propietario y el superadministrador, todos; el administrador, todos MENOS ROLES_SOLO_PRINCIPAL.
export const INVITABLE_ROLES = ['admin', 'operator', 'operador', 'viewer', 'visor', 'collector']

// Roles que SOLO invita el PRINCIPAL de la empresa (company_owner, o super_admin/superadmin). Un administrador no invita
// administradores: nacen sin filas de proyecto, es decir exentos (D-2). El control real del camino directo
// (INSERT en user_invitations por la API) es la política user_invitations_insert de la migración 20261026000700; accept-invitation
// no puede confiar en invited_by (lo escribe quien inserta).
export const ROLES_SOLO_PRINCIPAL = ['admin']

export const MSG_SOLO_PRINCIPAL_ADMIN = 'Solo el propietario de la empresa puede invitar administradores.'

// Fallo de la base de datos al leer las pendientes, al revocarlas o al insertar: mensaje genérico al cliente (el detalle va al registro con registroErrorBd).
export const MSG_NO_SE_PUDO_CREAR = 'No se pudo crear la invitación. Intenta de nuevo.'

// 409 por el índice único (empresa, correo) entre las pendientes. Para quien NO es el principal, la que queda es la invitación 'admin' del propietario (no
// puede revocarla); para el PRINCIPAL, que revoca todas las del correo, sólo puede ser otra creada entre su revocación y su INSERT (V8-07 B2).
export const MSG_PENDIENTE_DEL_PROPIETARIO = 'Ya hay una invitación pendiente para ese correo; la gestiona el propietario de la empresa.'
export const MSG_PENDIENTE_RECIEN_CREADA = 'Otra invitación pendiente para ese correo acaba de crearse. Recarga la página e inténtalo de nuevo.'

/** Mensaje del 409 por invitación pendiente duplicada según quién invita (ver MSG_PENDIENTE_*). */
export function msgConflictoPendiente(invitaElPrincipal: boolean): string {
  return invitaElPrincipal ? MSG_PENDIENTE_RECIEN_CREADA : MSG_PENDIENTE_DEL_PROPIETARIO
}

/**
 * Lo que se registra de un error de la base de datos: código y mensaje. NO `details` ni `hint`: en una violación de unicidad o de clave foránea `details`
 * repite los valores de la fila («Key (company_id, email)=(…, ana@…)»), es decir, el correo de la persona invitada.
 */
export function registroErrorBd(err: { code?: unknown; message?: unknown }): { code: string | null; message: string | null } {
  return {
    code: typeof err.code === 'string' ? err.code : null,
    message: typeof err.message === 'string' ? err.message : null,
  }
}

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

/** `true` si `role` pertenece al universo invitable (whitelist). No dice QUIÉN puede invitarlo: ver canInviteRole. */
export function isInvitableRole(role: string): boolean {
  return INVITABLE_ROLES.includes(role)
}

/** `true` si el rol es el PRINCIPAL de la empresa: company_owner o super_admin/superadmin. Un administrador (acotado o exento) NO lo es. */
export function isPrincipalRole(role: string): boolean {
  return role === 'super_admin' || role === 'superadmin' || role === 'company_owner'
}

/**
 * `true` si `callerRole` puede invitar a alguien con `targetRole`: el llamador es super_admin/superadmin, company_owner o admin,
 * el rol está en el universo invitable y, si es un rol de ROLES_SOLO_PRINCIPAL ('admin'), el llamador es el principal.
 */
export function canInviteRole(callerRole: string, targetRole: string): boolean {
  if (!isPrincipalRole(callerRole) && callerRole !== 'admin') return false
  if (!isInvitableRole(targetRole)) return false
  if (ROLES_SOLO_PRINCIPAL.includes(targetRole)) return isPrincipalRole(callerRole)
  return true
}

/** `true` si el valor es texto o falta (undefined / null): el cuerpo llega de la red y un arreglo, un objeto o un número no se recortan (TypeError → 500): se rechazan con 400. */
export function isTextOrAbsent(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string'
}

/**
 * Ids de las invitaciones PENDIENTES que invitar de nuevo a `email` debe revocar: las del MISMO correo (recortado y en minúsculas, igualdad exacta: sin
 * comodines de LIKE) y, si quien invita no es el principal, SIN las de rol 'admin' (son del propietario).
 */
export function idsPendientesARevocar(
  pendientes: ReadonlyArray<{ id: string; email: string | null; role: string | null }>,
  email: string,
  invitaElPrincipal: boolean,
): string[] {
  const objetivo = email.trim().toLowerCase()
  if (objetivo === '') return []
  return pendientes
    .filter(p => (p.email ?? '').trim().toLowerCase() === objetivo)
    .filter(p => invitaElPrincipal || !ROLES_SOLO_PRINCIPAL.includes(p.role ?? ''))
    .map(p => p.id)
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
