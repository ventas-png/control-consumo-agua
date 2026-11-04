// Lógica pura de delete-own-account, extraída del handler para testearla en aislamiento (misma convención que delete-user/validate.ts y
// delete-company/logic.ts): sin Deno, supabase-js ni Stripe → corre directo en vitest. El handler (index.ts) importa estos símbolos.
//
// POR QUÉ EXISTE ESTA FUNCIÓN. La app permite registrarse (RegisterScreen / signup-company), así que Apple (App Review 5.1.1 v) y Google Play
// (política «Account deletion») exigen que la persona pueda INICIAR el borrado de su propia cuenta desde la app. delete-user no sirve: es para
// que un administrador elimine a OTROS, y se niega en seco a borrar al llamador («No puedes eliminar tu propia cuenta»). Aquí el objetivo es
// siempre el llamador, identificado por su JWT: no hay user_id en el cuerpo, luego no hay cross-tenant posible.
//
// QUÉ SE DECIDE AQUÍ (y por qué así; docs/ELIMINACION_CUENTA.md lo explica para soporte):
//   · Superadministradores: no se borran a sí mismos (403). Son operadores de la plataforma; los elimina otro superadministrador con delete-user.
//   · Propietario de empresa (company_owner):
//       - con OTRO propietario activo → se borra su cuenta y la empresa sigue (queda en manos del otro).
//       - único propietario y la empresa tiene MÁS usuarios activos (administradores, operadores…) → 409. Borrarlo dejaría una empresa viva sin
//         principal, y suspenderla dejaría fuera a un equipo entero por decisión unilateral. Se le dice qué hacer: desactivar/eliminar a esos
//         usuarios él mismo (Empresa › Usuarios) o pedir a soporte la transferencia de la propiedad. Un reviewer de Apple/Google nunca cae aquí:
//         su cuenta de prueba es una empresa recién creada y sola.
//       - único propietario y SOLO (sin más staff activo) → se borra su cuenta y la empresa queda SUSPENDIDA (companies.activa=false,
//         suspended_at=now), que es el mecanismo normal del ciclo de vida: entra en el periodo de gracia y después el superadministrador la purga
//         con delete-company (docs/PURGA_EMPRESA.md). Si tiene una suscripción Stripe viva se cancela ANTES de tocar nada, igual que delete-company:
//         jamás dejar un cobro recurrente a nombre de una persona que ya no existe.
//   · Resto del staff (admin, operador, visor, cobrador…) y cuentas de portal (cliente): se borran. Los vínculos «quién lo hizo» del esquema
//     pasan a NULL por FK (20260522000009): lecturas, pagos, tickets y pólizas se CONSERVAN (obligación contable de la empresa), sin el nombre.
//     La fila de `clientes` (el expediente que la empresa tiene del residente: unidad, lecturas, pagos) NO se borra: es un dato de la empresa,
//     que es la responsable del tratamiento; la persona puede pedirle a ella su supresión.
//   · Sesión sin fila en app_users (login huérfano): se borra el acceso igual. Si no, ese correo quedaría atado a una identidad que nadie puede
//     eliminar desde la app.

export const CONFIRM_WORD = 'ELIMINAR'

export const MSG_CUERPO_INVALIDO = 'Cuerpo inválido'
export const MSG_CONFIRMACION = `Escribe ${CONFIRM_WORD} para confirmar la eliminación de tu cuenta.`
export const MSG_SUPERADMIN =
  'Las cuentas de superadministrador no se eliminan desde aquí. Pide a otro superadministrador que elimine la tuya.'
export const MSG_SIN_STRIPE =
  'Tu empresa tiene una suscripción de pago activa y ahora mismo no podemos cancelarla automáticamente. Cancélala primero desde Mi perfil › Mi plan › Gestionar facturación y vuelve a intentarlo.'
export const MSG_STRIPE_FALLO = 'No se pudo cancelar la suscripción de tu empresa; tu cuenta no se eliminó. Intenta de nuevo en unos minutos.'
export const SUSPENSION_REASON = 'El propietario eliminó su cuenta desde la app (autoservicio); la empresa queda en periodo de gracia hasta su purga.'

/** Mensaje del 409 para el único propietario cuya empresa tiene más gente con acceso. `n` ≥ 1. */
export function msgUltimoPropietarioConEquipo(n: number): string {
  const quienes = n === 1 ? 'otra persona tiene acceso a ella' : `${n} personas más tienen acceso a ella`
  return (
    `Eres el único propietario de la empresa y ${quienes}. Antes de eliminar tu cuenta, desactiva o elimina a esos usuarios en ` +
    'Empresa › Usuarios (la empresa quedará suspendida junto con tu cuenta), o escribe a soporte@administratodo.com para transferir la propiedad a otra persona.'
  )
}

/** `true` si el rol es super_admin (ambas grafías históricas). Espejo de delete-user/validate.ts; la prueba fija que coinciden. */
export function isSuperAdminRole(role: string): boolean {
  return role === 'super_admin' || role === 'superadmin'
}

/** `true` si el rol es el PRINCIPAL de la empresa (company_owner o superadministrador). Espejo de delete-user/validate.ts. */
export function isPrincipalRole(role: string): boolean {
  return isSuperAdminRole(role) || role === 'company_owner'
}

export type SelfDeleteBody = { ok: true; dryRun: boolean } | { ok: false; error: string }

/**
 * Valida el cuerpo YA parseado (`await req.json().catch(() => null)`). Dos modos:
 *   · `{ dry_run: true }` → sólo se evalúan las compuertas (la UI lo usa para avisar de las consecuencias ANTES de pedir la contraseña).
 *   · `{ confirm: 'ELIMINAR' }` → borrado real. La palabra es exacta (mayúsculas), se tolera el espacio sobrante. Cualquier otra cosa es 400.
 * Un cuerpo que no es un objeto JSON (null, arreglo, número, JSON roto) es 400, nunca un TypeError → 500 (mismo criterio que delete-user).
 */
export function parseSelfDeleteBody(raw: unknown): SelfDeleteBody {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: MSG_CUERPO_INVALIDO }
  const body = raw as Record<string, unknown>
  if (body.dry_run === true) return { ok: true, dryRun: true }
  if (typeof body.confirm !== 'string' || body.confirm.trim() !== CONFIRM_WORD) return { ok: false, error: MSG_CONFIRMACION }
  return { ok: true, dryRun: false }
}

/** Fila del llamador en app_users (lo que el handler lee con service_role). `null` = login sin perfil. */
export interface SelfProfile {
  id: string
  role: string
  company_id: string | null
  full_name: string | null
  cliente_id: string | null
}

/** Fila mínima de las OTRAS personas de la empresa del llamador. */
export interface OtherUserRow {
  id: string
  role: string
  activo: boolean
}

export interface OtrosActivos {
  /** Otros propietarios (company_owner) ACTIVOS de la empresa, sin contar al llamador. */
  propietarios: number
  /** Otro staff ACTIVO de la empresa (administradores, operadores, visores, cobradores…), sin contar al llamador. */
  equipo: number
}

/**
 * Cuenta a las OTRAS personas activas de la empresa. Se descartan el propio llamador, las filas inactivas (`activo=false`: ya no entran), los
 * superadministradores (son de la plataforma, no del equipo de la empresa; la purga los desliga) y las cuentas de portal (`cliente`, que
 * además nunca llevan company_id). El handler ya filtra `activo = true` en la consulta; aquí se repite para no depender de ello.
 */
export function contarOtrosActivos(rows: OtherUserRow[], callerId: string): OtrosActivos {
  let propietarios = 0
  let equipo = 0
  for (const r of rows) {
    if (r.id === callerId || r.activo === false) continue
    if (isSuperAdminRole(r.role) || r.role === 'cliente') continue
    if (r.role === 'company_owner') propietarios++
    else equipo++
  }
  return { propietarios, equipo }
}

/** Resultado de la compuerta: ok (y si hay que suspender la empresa) o el status + mensaje exactos del handler. */
export type SelfDeleteGate = { ok: true; suspenderEmpresa: boolean } | { ok: false; status: number; error: string }

/**
 * Compuerta del borrado propio. Ver la cabecera del archivo para el porqué de cada rama. El orden importa: el superadministrador se rechaza
 * ANTES de mirar la empresa (un superadministrador con company_id —se puede desligar en la purga— no es un propietario).
 */
export function checkSelfDeleteGate(input: { profile: SelfProfile | null; otros: OtrosActivos }): SelfDeleteGate {
  const p = input.profile
  if (!p) return { ok: true, suspenderEmpresa: false }
  if (isSuperAdminRole(p.role)) return { ok: false, status: 403, error: MSG_SUPERADMIN }
  if (p.role === 'company_owner' && p.company_id) {
    if (input.otros.propietarios > 0) return { ok: true, suspenderEmpresa: false }
    if (input.otros.equipo > 0) return { ok: false, status: 409, error: msgUltimoPropietarioConEquipo(input.otros.equipo) }
    return { ok: true, suspenderEmpresa: true }
  }
  return { ok: true, suspenderEmpresa: false }
}

/** Estados en los que una suscripción sigue cobrando (o va a cobrar). Espejo de delete-company. */
export const LIVE_SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'incomplete']

/** `true` si el fallo al cancelar en Stripe es benigno (ya cancelada / inexistente). Espejo de delete-company/logic.ts. */
export function isBenignStripeCancelError(msg: string): boolean {
  return /No such subscription|canceled/i.test(msg)
}

/** `true` si `auth.admin.deleteUser` falló porque la identidad ya no existe: para un borrado eso es éxito. Espejo de delete-company/logic.ts. */
export function isAuthUserGone(err: { status?: number; code?: string; message?: string } | null | undefined): boolean {
  return !!err && (err.status === 404 || err.code === 'user_not_found')
}

/**
 * Fila de permission_audit_log tras el borrado. `action = 'user_deleted'` (admitido por el CHECK desde 20260522000010, es el mismo que escribe
 * delete-user). `actor_id` y `target_user_id` van null a propósito: los dos son la misma persona y su fila de app_users ya no existe (FK);
 * la identidad se preserva en `details`, con `self_service: true` para distinguirlo de una baja hecha por un administrador.
 */
export function buildSelfDeletedAudit(
  profile: SelfProfile,
  empresaSuspendida: boolean,
): { actor_id: null; target_user_id: null; action: 'user_deleted'; details: Record<string, unknown> } {
  return {
    actor_id: null,
    target_user_id: null,
    action: 'user_deleted',
    details: {
      deleted_user_id: profile.id,
      full_name: profile.full_name,
      role: profile.role,
      company_id: profile.company_id,
      cliente_id: profile.cliente_id,
      self_service: true,
      company_suspended: empresaSuspendida,
    },
  }
}

/** Fila de security_logs (sin FK a auth.users: sobrevive al borrado). Misma forma que el rastro de create-cliente-account. */
export function buildAccountDeletedSecurityLog(input: {
  userId: string
  profile: SelfProfile | null
  empresaSuspendida: boolean
  ip: string
  userAgent: string
  now?: Date
}): { user_id: string; event_type: 'account_deleted'; details: Record<string, unknown>; ip_address: string; user_agent: string; timestamp: string } {
  return {
    user_id: input.userId,
    event_type: 'account_deleted',
    details: {
      role: input.profile?.role ?? null,
      company_id: input.profile?.company_id ?? null,
      had_profile: input.profile !== null,
      company_suspended: input.empresaSuspendida,
      self_service: true,
    },
    ip_address: input.ip,
    user_agent: input.userAgent,
    timestamp: (input.now ?? new Date()).toISOString(),
  }
}
