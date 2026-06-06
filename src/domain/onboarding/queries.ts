// domain/onboarding/queries.ts — Lecturas del flujo de onboarding. T7/PR3.
import { supabase } from '../../lib/supabase'

/** Preview de una invitación (edge accept-invitation, action=preview). */
export interface InvitationPreview {
  valid?: boolean
  email?: string
  role?: string
  company_name?: string | null
  error?: string
}

/**
 * Lee el preview de una invitación vía el edge `accept-invitation` (action
 * 'preview'): empresa + rol + correo, sin crear nada. Devuelve `{ data, error }`.
 */
export async function previewInvitation(
  token: string,
): Promise<{ data: InvitationPreview | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('accept-invitation', {
    body: { token, action: 'preview' },
  })
  return { data: (data as InvitationPreview) ?? null, error: error?.message ?? null }
}
