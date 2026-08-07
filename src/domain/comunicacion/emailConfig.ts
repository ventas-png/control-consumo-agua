// domain/comunicacion/emailConfig.ts — Acceso a datos de la config de correo
// del tenant / superadmin (T7/PR3). Baja a domain/ lo que vivía inline en
// GoogleEmailConfig: `company_email_configs`, `email_templates` y
// `email_send_log` (con el scope superadmin vs empresa), más los edges
// google-oauth-initiate y send-email (fetch + token de sesión). El armado de
// vars/diálogos/toasts se queda en la UI; aquí sólo el I/O. Funciones planas
// (imperativas) porque el componente maneja su propio estado de carga.
import { reportDegradedQuery } from '../queryFetch'
import { supabase } from '../../lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

/** Scope de la config: superadmin (global) o una empresa concreta. */
export interface EmailScope {
  isSuperadmin: boolean
  companyId?: string | null
}

export interface EmailConfig {
  id: string
  email: string
  is_active: boolean
  updated_at: string
  from_name: string | null
  reply_to: string | null
}

export interface EmailTemplate {
  id: string
  template_key: string
  subject: string
  html_body: string
  is_active: boolean
}

export interface EmailSendLogRow {
  id: number
  template_key: string
  to_email: string
  from_email: string | null
  status: 'sent' | 'failed'
  error_message: string | null
  sent_at: string
  /** Tracking de apertura/bounce (com:N4) — sellos idempotentes del pipeline. */
  opened_at: string | null
  bounced_at: string | null
  bounce_reason: string | null
}

async function getAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession()
  reportDegradedQuery('comunicacion.getAccessToken', error)
  return data.session?.access_token ?? ''
}

/** Invoca un edge con el token de la sesión. Deja propagar errores de red. */
async function callFn(name: string, body: unknown): Promise<Response> {
  const token = await getAccessToken()
  return fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

// ── Lecturas (degradan a null/[]) ──

/** Config de correo del scope (maybeSingle → null si no hay cuenta conectada). */
export async function fetchEmailConfig(scope: EmailScope): Promise<EmailConfig | null> {
  const base = supabase
    .from('company_email_configs')
    .select('id, email, is_active, updated_at, from_name, reply_to')
  const { data, error } = await (
    scope.isSuperadmin ? base.eq('is_superadmin', true) : base.eq('company_id', scope.companyId!)
  ).maybeSingle()
  reportDegradedQuery('comunicacion.fetchEmailConfig', error)
  return (data as EmailConfig | null) ?? null
}

/** Templates de correo personalizados del scope. */
export async function fetchEmailTemplates(scope: EmailScope): Promise<EmailTemplate[]> {
  const base = supabase
    .from('email_templates')
    .select('id, template_key, subject, html_body, is_active')
  const { data, error } = await (
    scope.isSuperadmin ? base.eq('is_superadmin', true) : base.eq('company_id', scope.companyId!)
  )
  reportDegradedQuery('comunicacion.fetchEmailTemplates', error)
  return (data as EmailTemplate[]) ?? []
}

/** Últimos 20 envíos del log de correo del scope. */
export async function fetchEmailSendLog(scope: EmailScope): Promise<EmailSendLogRow[]> {
  const base = supabase
    .from('email_send_log')
    .select('id, template_key, to_email, from_email, status, error_message, sent_at, opened_at, bounced_at, bounce_reason')
  const { data, error } = await (
    scope.isSuperadmin ? base.eq('is_superadmin', true) : base.eq('company_id', scope.companyId!)
  )
    .order('sent_at', { ascending: false })
    .limit(20)
  reportDegradedQuery('comunicacion.fetchEmailSendLog', error)
  return (data as EmailSendLogRow[]) ?? []
}

// ── Mutaciones ──

/** Desconecta la cuenta (borra la fila de config del scope). */
export async function deleteEmailConfig(scope: EmailScope): Promise<{ error: string | null }> {
  const base = supabase.from('company_email_configs').delete()
  const { error } = await (
    scope.isSuperadmin ? base.eq('is_superadmin', true) : base.eq('company_id', scope.companyId)
  )
  return { error: error?.message ?? null }
}

/** Actualiza los metadatos (from_name/reply_to) de la config por id. */
export async function updateEmailConfigMeta(
  configId: string,
  patch: { from_name: string | null; reply_to: string | null },
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('company_email_configs').update(patch).eq('id', configId)
  return { error: error?.message ?? null }
}

/** Actualiza un template existente por id (asunto + cuerpo). */
export async function updateEmailTemplate(
  templateId: string,
  patch: { subject: string; html_body: string },
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('email_templates')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', templateId)
  return { error: error?.message ?? null }
}

/** Crea un template para el scope (template_key + asunto + cuerpo). */
export async function insertEmailTemplate(
  scope: EmailScope,
  values: { template_key: string; subject: string; html_body: string },
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('email_templates').insert({
    ...values,
    ...(scope.isSuperadmin ? { is_superadmin: true } : { company_id: scope.companyId }),
  })
  return { error: error?.message ?? null }
}

/** Elimina la personalización de un template por id. */
export async function deleteEmailTemplate(templateId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('email_templates').delete().eq('id', templateId)
  return { error: error?.message ?? null }
}

// ── Edges ──

/**
 * Inicia el OAuth de Google (edge `google-oauth-initiate`). Devuelve la `url` de
 * redirección o un mensaje de error. Deja propagar errores de red (la UI los
 * captura aparte). El body (scope) lo arma la UI.
 */
export async function initiateGoogleOAuth(
  body: Record<string, unknown>,
): Promise<{ url: string | null; error: string | null }> {
  const res = await callFn('google-oauth-initiate', body)
  const data = (await res.json()) as { url?: string; error?: string }
  if (!res.ok || !data.url) {
    return { url: null, error: data.error ?? 'No se pudo iniciar la conexión con Google.' }
  }
  return { url: data.url, error: null }
}

/**
 * Envía un correo de prueba/operativo (edge `send-email`). Devuelve `{ ok, error }`.
 * Deja propagar errores de red. El body (scope/template/vars) lo arma la UI.
 */
export async function sendEmail(
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error: string | null }> {
  const res = await callFn('send-email', body)
  if (res.ok) return { ok: true, error: null }
  const err = (await res.json()) as { error?: string }
  return { ok: false, error: err.error ?? null }
}
