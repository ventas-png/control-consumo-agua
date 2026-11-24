// Lógica pura de update-user (sin Deno ni supabase-js → corre directo en vitest). El handler (index.ts) importa estos símbolos.
//
// update-user deja que el PRINCIPAL de la empresa (company_owner, o super_admin/superadmin) edite los datos de una persona de su empresa: el nombre (app_users.full_name)
// y sus datos de acceso (correo y contraseña, en auth.users, que sólo se escriben con service_role). Cambiar el correo o la contraseña de alguien equivale a poder entrar como
// esa persona: por eso NO lo hace un administrador (acotado a sus proyectos o exento), igual que no asigna proyectos ni permisos ni activa o desactiva personas (decisión del
// dueño del negocio, 2026-10-11: la autoridad es del principal).

// Roles que el principal de una empresa puede editar. Espejo de DELETABLE_ROLES de delete-user: nunca a otro propietario ni a un superadministrador, ni a una cuenta de
// cliente/residente (esas viven sin company_id y se gestionan desde el portal de clientes).
export const EDITABLE_ROLES = ['admin', 'operator', 'operador', 'viewer', 'visor', 'collector']

export const MSG_SOLO_PRINCIPAL_EDITAR = 'Solo el propietario de la empresa puede editar los datos de una persona.'

export const PASSWORD_MIN = 8
export const FULL_NAME_MAX = 120

/** `true` si el rol es super_admin (ambas grafías históricas). */
export function isSuperAdminRole(role: string): boolean {
  return role === 'super_admin' || role === 'superadmin'
}

/** `true` si el rol es el PRINCIPAL de la empresa: company_owner o super_admin/superadmin. Un administrador (acotado o exento) NO lo es. */
export function isPrincipalRole(role: string): boolean {
  return isSuperAdminRole(role) || role === 'company_owner'
}

/** `true` si el valor es texto o falta (undefined / null). Espejo de isTextOrAbsent de create-user / delete-user / invite-user. */
export function isTextOrAbsent(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string'
}

/** Normaliza el email (trim + lowercase): el login lo normaliza, así que el valor guardado debe estarlo también. */
export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase()
}

/** Fila mínima de la persona objetivo (lo que el handler lee de app_users). */
export interface TargetUserRow {
  id: string
  role: string
  company_id: string | null
  full_name: string
}

export type EditGate = { ok: true } | { ok: false; error: string }

/**
 * Gate de edición sobre la persona objetivo. El superadministrador edita a cualquiera; el propietario, SÓLO dentro de su propia empresa (sin empresa —company_id null o
 * vacío— no tiene «su empresa» y no edita a nadie) y sólo a los roles de EDITABLE_ROLES. Nadie más edita. El check de empresa va primero (mismo orden que delete-user).
 */
export function checkEditTargetGate(input: {
  callerRole: string
  callerCompanyId: string | null
  target: Pick<TargetUserRow, 'role' | 'company_id'>
}): EditGate {
  if (isSuperAdminRole(input.callerRole)) return { ok: true }
  if (input.callerRole !== 'company_owner') return { ok: false, error: MSG_SOLO_PRINCIPAL_EDITAR }
  if (!input.callerCompanyId || input.target.company_id !== input.callerCompanyId) {
    return { ok: false, error: 'No puedes editar usuarios de otra empresa' }
  }
  if (!EDITABLE_ROLES.includes(input.target.role)) {
    return { ok: false, error: 'No tienes permiso para editar a este usuario' }
  }
  return { ok: true }
}

/** Lo que se pide cambiar, ya normalizado. Un campo ausente (undefined) NO se toca. */
export interface Cambios {
  full_name?: string
  email?: string
  password?: string
}

// Deliberadamente simple: una dirección con una arroba, sin espacios y con un punto en el dominio. La validación real la hace Supabase Auth.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Normaliza y valida los campos del cuerpo. Un campo ausente o null no se cambia; uno PRESENTE debe ser válido (un nombre o un correo vacíos son un error, no «sin cambio»:
 * quien no quiere cambiarlo no lo envía). La contraseña no se recorta: los espacios son parte de ella.
 */
export function parseCambios(body: {
  full_name?: string | null
  email?: string | null
  password?: string | null
}): { ok: true; cambios: Cambios } | { ok: false; error: string } {
  const cambios: Cambios = {}
  if (body.full_name !== undefined && body.full_name !== null) {
    const nombre = body.full_name.trim()
    if (!nombre) return { ok: false, error: 'El nombre no puede quedar vacío' }
    if (nombre.length > FULL_NAME_MAX) return { ok: false, error: `El nombre no puede pasar de ${FULL_NAME_MAX} caracteres` }
    cambios.full_name = nombre
  }
  if (body.email !== undefined && body.email !== null) {
    const email = normalizeEmail(body.email)
    if (!EMAIL.test(email)) return { ok: false, error: 'El correo electrónico no es válido' }
    cambios.email = email
  }
  if (body.password !== undefined && body.password !== null) {
    if (body.password.length < PASSWORD_MIN) return { ok: false, error: `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres` }
    cambios.password = body.password
  }
  return { ok: true, cambios }
}

/**
 * Quita de `cambios` lo que ya vale lo mismo (mismo nombre, mismo correo): no se escribe ni se audita un cambio que no lo es. La contraseña siempre cuenta
 * (no se puede comparar con la actual).
 */
export function cambiosEfectivos(cambios: Cambios, actual: { full_name: string; email: string | null }): Cambios {
  const efectivos: Cambios = {}
  if (cambios.full_name !== undefined && cambios.full_name !== actual.full_name) efectivos.full_name = cambios.full_name
  if (cambios.email !== undefined && cambios.email !== normalizeEmail(actual.email)) efectivos.email = cambios.email
  if (cambios.password !== undefined) efectivos.password = cambios.password
  return efectivos
}

/** Fila de permission_audit_log del cambio. NUNCA lleva la contraseña: sólo que se cambió. */
export function buildUserUpdatedAudit(
  callerId: string,
  target: TargetUserRow,
  emailAnterior: string | null,
  cambios: Cambios,
): {
  actor_id: string
  target_user_id: string
  action: string
  details: Record<string, unknown>
} {
  const details: Record<string, unknown> = {
    changed: (['full_name', 'email', 'password'] as const).filter(c => cambios[c] !== undefined),
    company_id: target.company_id,
  }
  if (cambios.full_name !== undefined) {
    details.full_name_before = target.full_name
    details.full_name_after = cambios.full_name
  }
  if (cambios.email !== undefined) {
    details.email_before = emailAnterior
    details.email_after = cambios.email
  }
  return { actor_id: callerId, target_user_id: target.id, action: 'user_updated', details }
}

/** Traduce el error de Supabase Auth al actualizar el acceso a un mensaje que se pueda mostrar tal cual. */
export function mensajeErrorAuth(message: string | null | undefined): string {
  const m = message ?? ''
  if (/already (been )?registered|already exists|email_exists|duplicate/i.test(m)) return 'Ese correo ya está en uso por otra cuenta.'
  if (/password/i.test(m)) return 'La contraseña no cumple los requisitos de seguridad: ' + m
  return 'No se pudieron actualizar los datos de acceso: ' + (m || 'error desconocido')
}
