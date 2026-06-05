// T3 · plat:P10 — Schemas Zod del dominio SSO (SSO/SAML enterprise).
//
// Fuente de verdad cliente↔DB para:
//   - `company_sso_domains` (fila leída por owner/admin vía RLS).
//   - el resultado de la RPC anon-callable `sso_lookup_domain` (descubrimiento
//     PRE-login: ¿este dominio usa SSO? ¿está forzado? provider hint).
//
// Convención del repo: schemas terminan en `Schema`; los tipos se infieren del
// schema (`z.infer`) para no duplicar interfaces.
import { z } from 'zod'

// ── Validación de dominio de correo ─────────────────────────────────────────
// Acepta 'acme.com', 'sub.acme.co.uk'. Rechaza vacíos, espacios, '@', esquemas.
// Se normaliza a minúsculas (en DB es citext, así que el match es
// case-insensitive de todos modos; aquí lo normalizamos para UI/almacenamiento).
const DOMAIN_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/

export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => DOMAIN_RE.test(v), { message: 'Dominio inválido (ej. acme.com)' })

// ── Fila de company_sso_domains ─────────────────────────────────────────────
export const ssoDomainSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  domain: z.string(),
  sso_provider_id: z.string().nullable(),
  verified: z.boolean(),
  verification_token: z.string(),
  enforced: z.boolean(),
  // Metadata IdP persistida (parqueable). Columna jsonb NOT NULL DEFAULT '{}'.
  idp_metadata: z.record(z.string(), z.unknown()).optional().default({}),
  created_at: z.string(),
  updated_at: z.string(),
})
export type SsoDomain = z.infer<typeof ssoDomainSchema>

// ── Resultado crudo de la RPC sso_lookup_domain ─────────────────────────────
export const ssoLookupRowSchema = z.object({
  sso_available: z.boolean(),
  enforced: z.boolean(),
  provider_id: z.string().nullable(),
})
export type SsoLookupRow = z.infer<typeof ssoLookupRowSchema>

// ── Resultado normalizado para consumo en UI/login ──────────────────────────
export interface SsoLookupResult {
  /** ¿El dominio usa SSO (verificado)? Si false, login normal por password. */
  available: boolean
  /** ¿SSO obligatorio? Si true, el login oculta el campo de password. */
  enforced: boolean
  /** Provider hint para signInWithSSO (puede ser null si aún no sincronizado). */
  providerId: string | null
}

/** "Sin SSO" — el caso por defecto (fallback graceful: login = password). */
export const SSO_LOOKUP_NONE: SsoLookupResult = {
  available: false,
  enforced: false,
  providerId: null,
}

/**
 * Normaliza el resultado crudo de `sso_lookup_domain` (array de 0..1 filas) al
 * shape de UI. PURO/testeable. Defensivo: filas vacías, malformadas o con
 * `sso_available !== true` → SSO_LOOKUP_NONE (degradación graceful a password).
 */
export function parseSsoLookup(rows: unknown): SsoLookupResult {
  const arr = Array.isArray(rows) ? rows : rows == null ? [] : [rows]
  const first = arr[0]
  if (first == null) return SSO_LOOKUP_NONE
  const parsed = ssoLookupRowSchema.safeParse(first)
  if (!parsed.success || parsed.data.sso_available !== true) return SSO_LOOKUP_NONE
  return {
    available: true,
    enforced: parsed.data.enforced === true,
    providerId: parsed.data.provider_id,
  }
}
