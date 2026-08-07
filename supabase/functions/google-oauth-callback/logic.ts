// Lógica pura de google-oauth-callback, extraída del handler para poder
// testearla en aislamiento (infra:I22 · Track T8/T5). Sin Deno ni supabase-js →
// corre directo en vitest. El handler (index.ts) importa estos símbolos: el
// comportamiento no cambia, solo se mueve la definición a un archivo importable.
//
// Invariantes de seguridad que fija este módulo:
//   - Validación del state anti-CSRF (parseo + type tag + ventana de 15 min).
//   - Autorización del scope contra el rol/empresa REAL del caller (el state va
//     sin firmar: aunque alguien lo fabrique, aquí se rechaza).
//   - Forma de la fila company_email_configs: superadmin ⇒ company_id null;
//     tenant ⇒ company_id del state e is_superadmin false. Nunca se mezclan.

/** Payload del state generado por google-oauth-initiate. */
export interface StatePayload {
  t: string
  company_id: string | null
  is_superadmin: boolean
  ts: number
}

// Ventana de validez del state: 15 minutos.
export const OAUTH_STATE_TTL_MS = 15 * 60 * 1000

export type OAuthStateValidation =
  | { ok: true; state: StatePayload }
  | { ok: false; error: string }

/**
 * Decodifica y valida el state, replicando los tres rechazos del handler (todos
 * responden 400) en el mismo orden y con los mismos mensajes:
 *   1. no parseable (base64/JSON) → 'Invalid state parameter'.
 *   2. type tag ≠ 'gmail_connect' → 'Invalid OAuth flow type' (evita reusar un
 *      state de otro flujo OAuth).
 *   3. más viejo que 15 min → 'OAuth state expired. Please try again.'
 * `nowMs` inyectable para test determinista.
 */
export function validateOAuthState(raw: string, nowMs: number = Date.now()): OAuthStateValidation {
  let stateData: StatePayload
  try {
    stateData = JSON.parse(atob(raw)) as StatePayload
  } catch {
    return { ok: false, error: 'Invalid state parameter' }
  }

  if (stateData.t !== 'gmail_connect') {
    return { ok: false, error: 'Invalid OAuth flow type' }
  }

  // Reject stale states (15-minute window)
  if (nowMs - stateData.ts > OAUTH_STATE_TTL_MS) {
    return { ok: false, error: 'OAuth state expired. Please try again.' }
  }

  return { ok: true, state: stateData }
}

/**
 * Autorización del scope a conectar, contra el rol/empresa REAL del caller (no
 * contra el state, que va sin firmar). Misma decisión que google-oauth-initiate:
 *   - is_superadmin → solo super_admin/superadmin.
 *   - company_id → super_admin, o admin/company_owner de ESA misma empresa.
 */
export function canConnectEmailScope(
  requested: { companyId: string | null; isSuperadmin: boolean },
  caller: { role: string; companyId: string | null },
): boolean {
  const isSuper = caller.role === 'super_admin' || caller.role === 'superadmin'
  return requested.isSuperadmin
    ? isSuper
    : isSuper || (['admin', 'company_owner'].includes(caller.role) && caller.companyId === requested.companyId)
}

// Tipos estructurales mínimos de la respuesta de Google (sin importar SDKs).
export interface OAuthTokens {
  access_token: string
  refresh_token?: string
  expires_in: number
}

/**
 * Construye la fila de company_email_configs a insertar (el delete+insert lo
 * hace el handler). Réplica exacta del `record` inline:
 *   - refresh_token ausente → null (Google solo lo manda la primera vez).
 *   - token_expiry = now + expires_in segundos (ISO).
 *   - superadmin ⇒ { company_id: null, is_superadmin: true }; tenant ⇒
 *     { company_id: <del state>, is_superadmin: false }.
 * `nowMs` inyectable para test determinista.
 */
export function buildEmailConfigRecord(
  tokens: OAuthTokens,
  gmailEmail: string,
  state: { company_id: string | null; is_superadmin: boolean },
  nowMs: number = Date.now(),
  /**
   * Tokens YA CIFRADOS. El cifrado en reposo (P0 #7) lo hace el handler con
   * `encryptSecret()`, que es async y vive en _shared/secretsCrypto.ts — no
   * puede entrar aquí sin romper la pureza de este módulo. Se llaman así a
   * propósito: si alguien pasa los tokens en claro, quedan sin cifrar en la
   * tabla y nada lo delata.
   */
  accessTokenCifrado: string,
  refreshTokenCifrado: string | null,
) {
  return {
    provider: 'google',
    email: gmailEmail,
    access_token: accessTokenCifrado,
    refresh_token: refreshTokenCifrado,
    token_expiry: new Date(nowMs + tokens.expires_in * 1000).toISOString(),
    is_active: true,
    updated_at: new Date(nowMs).toISOString(),
    ...(state.is_superadmin
      ? { company_id: null, is_superadmin: true }
      : { company_id: state.company_id, is_superadmin: false }),
  }
}
