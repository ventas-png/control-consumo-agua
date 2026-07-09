// Lógica pura de google-oauth-initiate, extraída del handler para poder
// testearla en aislamiento (infra:I22 · Track T8/T5). Sin Deno ni supabase-js →
// corre directo en vitest. El handler (index.ts) importa estos símbolos: el
// comportamiento no cambia, solo se mueve la definición a un archivo importable.
//
// Invariantes de seguridad que fija este módulo:
//   - Autorización del scope: quién puede iniciar la conexión de Gmail de una
//     empresa / del superadmin de plataforma (nunca se confía solo en el body).
//   - Scopes de Google de mínimo privilegio (gmail.send, NUNCA gmail completo).
//   - Forma del state anti-CSRF (type tag + scope + timestamp).

/**
 * Autorización del scope a conectar, contra el rol/empresa REAL del caller:
 *   - is_superadmin → solo super_admin/superadmin.
 *   - company_id → super_admin, o admin/company_owner de ESA misma empresa.
 * Cierra el secuestro de la config de email de otro tenant o de plataforma.
 * Réplica exacta de la decisión inline del handler.
 */
export function canConnectEmailScope(
  requested: { companyId?: string | null; isSuperadmin?: boolean },
  caller: { role: string; companyId: string | null },
): boolean {
  const isSuper = caller.role === 'super_admin' || caller.role === 'superadmin'
  return requested.isSuperadmin
    ? isSuper
    : isSuper || (['admin', 'company_owner'].includes(caller.role) && caller.companyId === requested.companyId)
}

/**
 * State anti-CSRF: base64 de JSON con type tag + scope + timestamp. `nowMs`
 * inyectable para test determinista (el handler no lo pasa → Date.now()).
 */
export function buildOAuthState(
  input: { companyId?: string | null; isSuperadmin?: boolean },
  nowMs: number = Date.now(),
): string {
  const statePayload = {
    t: 'gmail_connect',
    company_id: input.companyId ?? null,
    is_superadmin: input.isSuperadmin ?? false,
    ts: nowMs,
  }
  return btoa(JSON.stringify(statePayload))
}

// Scopes de Google de mínimo privilegio: enviar correo + identificar la cuenta.
// NUNCA gmail readonly/full ni scopes de Drive/Calendar.
export const GMAIL_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

/** URL de consentimiento de Google (idéntica a la que armaba el handler). */
export function buildGoogleAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_OAUTH_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent select_account',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}
