// Lógica pura de complete-oauth-onboarding, extraída del handler para poder
// testearla en aislamiento (infra:I22 · Track T8/T5). Sin Deno ni supabase-js →
// corre directo en vitest. El handler (index.ts) importa estos símbolos: el
// comportamiento no cambia, solo se mueve la decisión a un archivo importable.

// Error genérico de identidad — el MISMO mensaje para todos los modos de fallo
// (no encontrado, match parcial, cliente ya vinculado) para impedir enumeración.
export const IDENTITY_ERROR = 'No se encontró un cliente con los datos proporcionados. Verifique su DPI/CUI y fecha de nacimiento.'

/**
 * Nombre a mostrar del usuario OAuth: metadata del proveedor (full_name → name)
 * con fallback al email. Ojo: `??` solo cae en null/undefined — un string vacío
 * en full_name se conserva tal cual (comportamiento del handler, fijado aquí).
 */
export function resolveFullName(
  meta: Record<string, unknown> | null | undefined,
  email: string,
): string {
  return (meta?.full_name as string | undefined) ??
    (meta?.name as string | undefined) ??
    email
}

const MAX_FULL_NAME = 120

/**
 * Nombre definitivo del perfil. Manda la metadata del proveedor (Google siempre
 * la trae; Apple la trae en la PRIMERA autorización y GoTrue la guarda). Si la
 * metadata no trae nombre, se acepta el que la persona escribió en el
 * formulario (recortado); si tampoco hay, se mantiene el comportamiento previo
 * (`resolveFullName`: email o cadena vacía).
 */
export function chooseFullName(
  meta: Record<string, unknown> | null | undefined,
  email: string,
  declaredName: string | null | undefined,
): string {
  const fromMeta = resolveFullName(meta, email)
  if (fromMeta.trim() && fromMeta !== email) return fromMeta
  const declared = typeof declaredName === 'string' ? declaredName.trim().slice(0, MAX_FULL_NAME) : ''
  return declared || fromMeta
}

/** Dominio de los alias de Sign in with Apple con «Ocultar mi correo». */
export const APPLE_PRIVATE_RELAY_DOMAIN = 'privaterelay.appleid.com'

/** `true` si el correo es un alias privado de Apple (Hide My Email). */
export function isPrivateRelayEmail(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase().endsWith(`@${APPLE_PRIVATE_RELAY_DOMAIN}`)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Correo con el que se busca al cliente en el padrón. SIEMPRE el del JWT (lo
 * verificó el proveedor), salvo cuando Apple lo ocultó tras un alias
 * @privaterelay.appleid.com: ese alias nunca coincide con el padrón, así que se
 * acepta el correo que la persona declara, igual que en el alta con contraseña
 * (create-cliente-account), y la identidad sigue siendo 3-de-3 (correo
 * declarado + DPI + fecha de nacimiento). Un correo declarado inválido se
 * ignora y se cae al alias (que no casará: IDENTITY_ERROR, sin revelar por qué).
 */
export function resolveLookupEmail(jwtEmail: string, declaredEmail: string | null | undefined): string {
  if (!isPrivateRelayEmail(jwtEmail)) return jwtEmail
  const declared = typeof declaredEmail === 'string' ? declaredEmail.trim().toLowerCase() : ''
  return EMAIL_RE.test(declared) ? declared : jwtEmail
}

/** Resultado del RPC buscar_cliente_para_onboarding (SECURITY DEFINER). */
export interface OnboardingLookup {
  match_count: number
  cliente_id: string | null
}

/**
 * `true` solo con match 3-de-3 (email del JWT + DPI + fecha de nacimiento) Y
 * cliente_id presente. Cualquier match parcial se trata como no-encontrado
 * (IDENTITY_ERROR) para no revelar qué campo falló.
 */
export function isIdentityMatch(result: OnboardingLookup): boolean {
  return !(result.match_count < 3 || !result.cliente_id)
}

/**
 * Fila de app_users del nuevo residente OAuth. El rol es SIEMPRE 'cliente' —
 * el onboarding jamás puede producir otro rol (anti escalada de privilegios).
 */
export function buildClienteProfileRow(userId: string, fullName: string, clienteId: string): {
  id: string
  full_name: string
  role: 'cliente'
  cliente_id: string
  activo: true
} {
  return {
    id: userId,
    full_name: fullName.trim(),
    role: 'cliente',
    cliente_id: clienteId,
    activo: true,
  }
}
