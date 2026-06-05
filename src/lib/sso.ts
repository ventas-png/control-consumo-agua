// T3 · plat:P10 — Wrapper de SSO para el login + detección PURA de dominio.
//
// TODA la lógica SSO del login vive aquí (NO se toca useAuth.ts, que es T7):
//   - `extractEmailDomain` — helper PURO/testeable (dominio del email).
//   - `detectSsoForEmail` — combina extracción + lookup (RPC anon sso_lookup_domain).
//   - `signInWithSso` — envoltorio de supabase.auth.signInWithSSO({ domain }).
//
// FALLBACK GRACEFUL: si SSO no está habilitado en el proyecto (handshake
// parqueado), `detectSsoForEmail` devuelve "sin SSO" y `signInWithSso` devuelve
// un error legible — el login sigue funcionando EXACTAMENTE como hoy (password).
import { supabase } from './supabase'
import { lookupSsoDomain } from '../domain/sso/queries'
import { SSO_LOOKUP_NONE, type SsoLookupResult } from '../domain/sso/schemas'

/**
 * Extrae el dominio de un email. PURO. Devuelve el dominio en minúsculas o null
 * si el input no tiene forma de email con exactamente un '@' y un dominio válido.
 */
export function extractEmailDomain(email: string): string | null {
  if (typeof email !== 'string') return null
  const trimmed = email.trim().toLowerCase()
  if (/\s/.test(trimmed)) return null
  const at = trimmed.indexOf('@')
  if (at <= 0 || at !== trimmed.lastIndexOf('@')) return null
  const domain = trimmed.slice(at + 1)
  // Dominio mínimo: algo.tld, sin espacios, con al menos un punto interno.
  if (!domain || /\s/.test(domain)) return null
  if (!/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(domain)) return null
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return null
  return domain
}

export interface SsoEmailDetection extends SsoLookupResult {
  /** Dominio detectado del email (o null si el email no es válido aún). */
  domain: string | null
}

/**
 * Detecta si el dominio del email usa SSO. Combina `extractEmailDomain` con la
 * RPC `sso_lookup_domain`. Si el email no tiene dominio válido o SSO no está
 * habilitado, devuelve "sin SSO" (login = password).
 */
export async function detectSsoForEmail(email: string): Promise<SsoEmailDetection> {
  const domain = extractEmailDomain(email)
  if (!domain) return { ...SSO_LOOKUP_NONE, domain: null }
  const res = await lookupSsoDomain(domain)
  return { ...res, domain }
}

export interface SsoSignInResult {
  /** URL de redirección al IdP (si la hubo; el navegador ya fue redirigido). */
  url?: string
  /** Mensaje de error legible si SSO falló / no está habilitado. */
  error?: string
}

/**
 * Inicia el flujo SSO vía supabase.auth.signInWithSSO. Acepta `domain` (lo más
 * común; GoTrue resuelve el proveedor) o `providerId`. Si recibe una URL de
 * redirección, navega a ella. Ante cualquier error (incl. SSO no habilitado en
 * el proyecto), devuelve `{ error }` para que el caller degrade a password.
 *
 * NOTA (handshake parqueado): el redirect real solo funciona cuando SSO está
 * habilitado a nivel proyecto (plan Pro + GOTRUE_SAML_ENABLED + clave de firma +
 * proveedor registrado). Hasta entonces esto devuelve error de forma graceful.
 */
export async function signInWithSso(params: { domain?: string; providerId?: string }): Promise<SsoSignInResult> {
  try {
    const arg = params.providerId
      ? { providerId: params.providerId }
      : params.domain
        ? { domain: params.domain }
        : null
    if (!arg) return { error: 'Falta el dominio o el proveedor de SSO.' }

    const { data, error } = await supabase.auth.signInWithSSO(arg)
    if (error) return { error: error.message }
    if (data?.url) {
      if (typeof window !== 'undefined') window.location.assign(data.url)
      return { url: data.url }
    }
    return { error: 'No se recibió la URL de redirección de SSO.' }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'No se pudo iniciar SSO.' }
  }
}

export type { SsoLookupResult }
