// domain/auth/account.ts — Escrituras del flujo de cuenta/credenciales. T7/PR3:
// alta de cliente / empresa (edge), onboarding OAuth (edge), recuperación y
// cambio de contraseña, y sign-out. El armado del payload se queda en la UI;
// aquí sólo baja el acceso a Supabase (auth + functions). Devuelve `{ error }`
// mapeado a `string` (la convención del dominio) para que la UI no toque tipos
// de supabase.
import { reportDegradedQuery } from '../queryFetch'
import { supabase } from '../../lib/supabase'

/** Respuesta común de las Edge Functions de cuenta. */
export interface AccountFnResult {
  success?: boolean
  error?: string
}

export interface CreateClienteAccountPayload {
  full_name: string
  email: string
  cui_dui: string
  fecha_nacimiento: string
  password: string
  legal_accepted: boolean
}

/**
 * Alta de cuenta de cliente vía el edge `create-cliente-account` (verifica la
 * identidad contra `clientes` y crea el auth user + app_users). Devuelve
 * `{ data, error }`.
 */
export async function createClienteAccount(
  payload: CreateClienteAccountPayload,
): Promise<{ data: AccountFnResult | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('create-cliente-account', { body: payload })
  return { data: (data as AccountFnResult) ?? null, error: error?.message ?? null }
}

export interface SignupCompanyPayload {
  email: string
  password: string
  full_name: string
  company_name: string
  phone?: string
  /** Moneda de cobro de la empresa (ISO 4217 minúsculas, ej. 'gtq'). */
  default_currency?: string
  servicio_agua: boolean
  servicio_condominios: boolean
  legal_accepted: boolean
}

/**
 * Alta de empresa (self-serve) vía el edge `signup-company`: crea la company +
 * owner + flags de servicio. Devuelve `{ data, error }`.
 */
export async function signupCompany(
  payload: SignupCompanyPayload,
): Promise<{ data: AccountFnResult | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('signup-company', { body: payload })
  return { data: (data as AccountFnResult) ?? null, error: error?.message ?? null }
}

export interface CompleteOAuthOnboardingPayload {
  cui_dui: string
  fecha_nacimiento: string
}

/**
 * Completa el onboarding de un usuario que entró por OAuth (Google): valida
 * identidad y vincula el `cliente`. Devuelve `{ data, error }`.
 */
export async function completeOAuthOnboarding(
  payload: CompleteOAuthOnboardingPayload,
): Promise<{ data: AccountFnResult | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('complete-oauth-onboarding', { body: payload })
  return { data: (data as AccountFnResult) ?? null, error: error?.message ?? null }
}

/** Solicita el correo de recuperación de contraseña (redirectTo lo arma la UI). */
export async function requestPasswordReset(
  email: string,
  redirectTo: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
  return { error: error?.message ?? null }
}

/** Cambia la contraseña del usuario de la sesión de recuperación activa. */
export async function updatePassword(newPassword: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  return { error: error?.message ?? null }
}

/** ¿Hay una sesión activa? (la página de reset la usa para validar el token de recovery). */
export async function hasActiveSession(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession()
  return !!session
}

/** Cierra la sesión local (sign-out simple). */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

/** Cierra TODAS las sesiones del usuario (tras cambiar la contraseña). */
export async function signOutGlobal(): Promise<void> {
  await supabase.auth.signOut({ scope: 'global' })
}

/** Proveedor de auth del usuario actual ('email' | 'google' | …); undefined si no hay sesión. */
export async function fetchCurrentAuthProvider(): Promise<string | undefined> {
  const { data, error } = await supabase.auth.getUser()
  reportDegradedQuery('auth.fetchCurrentAuthProvider', error)
  return data.user?.app_metadata?.provider as string | undefined
}

/** Reautentica con email + contraseña (verifica la contraseña actual antes de un cambio sensible). */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  return { error: error?.message ?? null }
}

/**
 * Solicita el cambio de email del usuario (Supabase envía verificación al nuevo
 * correo). Devuelve el mensaje de error CRUDO para que la UI lo clasifique
 * (rate limit / email en uso / genérico).
 */
export async function updateUserEmail(
  newEmail: string,
  emailRedirectTo: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.updateUser({ email: newEmail }, { emailRedirectTo })
  return { error: error?.message ?? null }
}

/**
 * Actualiza el nombre visible (`full_name`) del usuario en `app_users`. El caller
 * pasa el valor ya saneado (p.ej. trim). Devuelve `{ error }` mapeado a string.
 */
export async function updateAppUserName(
  userId: string,
  fullName: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('app_users')
    .update({ full_name: fullName })
    .eq('id', userId)
  return { error: error?.message ?? null }
}
