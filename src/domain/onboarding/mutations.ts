// domain/onboarding/mutations.ts — Escrituras del flujo de onboarding. T7/PR3:
// aceptar invitación (edge), iniciar sesión tras aceptar, y crear el primer
// proyecto desde el wizard de setup. El armado del payload se queda en la UI.
import { supabase } from '../../lib/supabase'

/** Resultado del edge accept-invitation (action=accept). */
export interface AcceptInvitationResult {
  success?: boolean
  email?: string
  error?: string
}

/**
 * Acepta una invitación vía el edge `accept-invitation`: crea el auth user +
 * app_users + rol RBAC y marca la invitación aceptada. Devuelve `{ data, error }`.
 */
export async function acceptInvitation(
  token: string,
  password: string,
  fullName?: string,
): Promise<{ data: AcceptInvitationResult | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('accept-invitation', {
    body: { token, password, full_name: fullName },
  })
  return { data: (data as AcceptInvitationResult) ?? null, error: error?.message ?? null }
}

/** Inicia sesión con correo + contraseña (auto-login tras aceptar la invitación). */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  return { error: error?.message ?? null }
}

/** Crea un proyecto (wizard de setup; payload ya armado por la UI). */
export async function createProject(payload: Record<string, unknown>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('projects').insert(payload)
  return { error: error?.message ?? null }
}
