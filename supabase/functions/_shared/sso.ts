// _shared/sso.ts — Lógica PURA del SSO/SAML admin (plat:P10), espejada para Deno.
//
// **Por qué** (frontera Deno/Vite, patrón I22): la edge function `sso-admin` no
// puede importar `src/`. Toda la lógica testeable —validar el input, normalizar
// dominios, construir el body para la GoTrue Admin SSO API y clasificar su
// respuesta (incluido detectar "SSO no habilitado en el proyecto" → parqueado)—
// vive aquí, importable tanto desde Deno (edge) como desde vitest (Node).
//
// NO importa nada de red: funciones puras sobre objetos ya recibidos por el
// caller. El edge hace I/O (auth, DB, fetch a GoTrue) usando estos helpers.

// ── Normalización/validación de dominio (espeja src/domain/sso/schemas.ts) ───
const DOMAIN_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/

/** Normaliza un dominio (trim+lowercase) y valida su forma. null si inválido. */
export function normalizeDomain(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const d = input.trim().toLowerCase()
  return DOMAIN_RE.test(d) ? d : null
}

// ── Acciones soportadas por el edge sso-admin ───────────────────────────────
export type SsoAdminAction =
  | { action: 'upsert_domain'; domain: string }
  | { action: 'delete_domain'; id: string }
  | { action: 'set_enforced'; id: string; enforced: boolean }
  | { action: 'start_verification'; id: string }
  | {
      action: 'save_metadata'
      id: string
      metadata: SsoIdpMetadata
    }

/** Metadata del IdP SAML que sube el admin (subset persistible + sincronizable). */
export interface SsoIdpMetadata {
  /** URL de metadata del IdP (alternativa a pegar el XML). */
  metadata_url?: string
  /** XML de metadata del IdP (alternativa a la URL). */
  metadata_xml?: string
  /** EntityID del IdP (opcional; suele venir dentro de la metadata). */
  entity_id?: string
  /** ACS URL (Assertion Consumer Service) del SP, si el IdP la requiere explícita. */
  acs_url?: string
  /** Mapeo de atributos SAML→claims (ej. { email: 'mail', name: 'displayName' }). */
  attribute_mapping?: Record<string, string>
}

export interface ParseError {
  error: string
}

function isStr(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

/**
 * Valida y normaliza el body del request de sso-admin. PURO. NUNCA acepta
 * company_id del cliente (se deriva de la sesión en el edge); aquí solo se
 * validan los campos de la acción.
 */
export function parseSsoAdminRequest(body: unknown): SsoAdminAction | ParseError {
  if (typeof body !== 'object' || body === null) return { error: 'Body inválido' }
  const b = body as Record<string, unknown>
  const action = b.action

  switch (action) {
    case 'upsert_domain': {
      const domain = normalizeDomain(b.domain)
      if (!domain) return { error: 'Dominio inválido (ej. acme.com)' }
      return { action, domain }
    }
    case 'delete_domain': {
      if (!isStr(b.id)) return { error: 'Falta id del dominio' }
      return { action, id: b.id.trim() }
    }
    case 'set_enforced': {
      if (!isStr(b.id)) return { error: 'Falta id del dominio' }
      if (typeof b.enforced !== 'boolean') return { error: 'enforced debe ser booleano' }
      return { action, id: b.id.trim(), enforced: b.enforced }
    }
    case 'start_verification': {
      if (!isStr(b.id)) return { error: 'Falta id del dominio' }
      return { action, id: b.id.trim() }
    }
    case 'save_metadata': {
      if (!isStr(b.id)) return { error: 'Falta id del dominio' }
      const md = (b.metadata ?? {}) as Record<string, unknown>
      const metadata = sanitizeIdpMetadata(md)
      if (!isStr(metadata.metadata_url) && !isStr(metadata.metadata_xml)) {
        return { error: 'Sube la metadata del IdP: una URL de metadata o el XML.' }
      }
      return { action, id: b.id.trim(), metadata }
    }
    default:
      return { error: 'Acción no soportada' }
  }
}

/** Filtra/normaliza la metadata a solo los campos conocidos (defensivo). */
export function sanitizeIdpMetadata(md: Record<string, unknown>): SsoIdpMetadata {
  const out: SsoIdpMetadata = {}
  if (isStr(md.metadata_url)) out.metadata_url = (md.metadata_url as string).trim()
  if (isStr(md.metadata_xml)) out.metadata_xml = (md.metadata_xml as string).trim()
  if (isStr(md.entity_id)) out.entity_id = (md.entity_id as string).trim()
  if (isStr(md.acs_url)) out.acs_url = (md.acs_url as string).trim()
  if (md.attribute_mapping && typeof md.attribute_mapping === 'object' && !Array.isArray(md.attribute_mapping)) {
    const am: Record<string, string> = {}
    for (const [k, v] of Object.entries(md.attribute_mapping as Record<string, unknown>)) {
      if (isStr(v)) am[k] = (v as string).trim()
    }
    if (Object.keys(am).length > 0) out.attribute_mapping = am
  }
  return out
}

// ── Construcción del body para la GoTrue Admin SSO API ───────────────────────
// POST {SUPABASE_URL}/auth/v1/admin/sso/providers  (Authorization: service_role)
// Forma esperada por GoTrue (SAML):
//   { type: 'saml', metadata_url? | metadata_xml?, domains: string[],
//     attribute_mapping?: { keys: {...} } }

export interface GoTrueProviderBody {
  type: 'saml'
  metadata_url?: string
  metadata_xml?: string
  domains?: string[]
  attribute_mapping?: { keys: Record<string, { name: string }> }
}

/**
 * Arma el body para registrar/sincronizar un proveedor SAML en GoTrue desde la
 * metadata subida + los dominios asociados. PURO. Prefiere metadata_url si está;
 * si no, usa metadata_xml. Mapea attribute_mapping al shape de GoTrue.
 */
export function buildGoTrueProviderBody(
  metadata: SsoIdpMetadata,
  domains: string[],
): GoTrueProviderBody {
  const body: GoTrueProviderBody = { type: 'saml' }
  if (metadata.metadata_url) body.metadata_url = metadata.metadata_url
  else if (metadata.metadata_xml) body.metadata_xml = metadata.metadata_xml
  const clean = domains.map((d) => d.trim().toLowerCase()).filter(Boolean)
  if (clean.length > 0) body.domains = clean
  if (metadata.attribute_mapping && Object.keys(metadata.attribute_mapping).length > 0) {
    const keys: Record<string, { name: string }> = {}
    for (const [claim, attr] of Object.entries(metadata.attribute_mapping)) {
      keys[claim] = { name: attr }
    }
    body.attribute_mapping = { keys }
  }
  return body
}

// ── Clasificación de la respuesta de GoTrue ─────────────────────────────────
export interface GoTrueResult {
  /** 'ok' = proveedor registrado/sincronizado; 'sso_disabled' = parqueado; 'error'. */
  status: 'ok' | 'sso_disabled' | 'error'
  /** ID del proveedor SAML cuando status==='ok'. */
  providerId?: string
  /** Mensaje legible (es) para la UI. */
  message: string
}

/**
 * Detecta si una respuesta de GoTrue indica que SSO NO está habilitado a nivel
 * proyecto (plan/flag), para responder "parqueado" sin romper nada. PURO.
 *
 * GoTrue devuelve, según versión/config: 404/501 en la ruta admin/sso cuando el
 * feature está apagado, o un body con error_code/msg que menciona "SAML"/"SSO"
 * "not enabled"/"disabled". Se reconoce de forma laxa para ser robusto entre
 * versiones.
 */
export function isSsoDisabledResponse(status: number, body: unknown): boolean {
  if (status === 404 || status === 501) return true
  const text = extractMessage(body).toLowerCase()
  if (!text) return false
  const mentionsSso = text.includes('saml') || text.includes('sso')
  const mentionsOff =
    text.includes('not enabled') ||
    text.includes('disabled') ||
    text.includes('not configured') ||
    text.includes('unsupported') ||
    text.includes('feature')
  return mentionsSso && mentionsOff
}

/** Extrae un mensaje legible de un body de GoTrue (jsonb o string). */
export function extractMessage(body: unknown): string {
  if (typeof body === 'string') return body
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    for (const k of ['msg', 'message', 'error_description', 'error', 'error_code']) {
      if (typeof b[k] === 'string') return b[k] as string
    }
  }
  return ''
}

/**
 * Clasifica la respuesta de la GoTrue Admin SSO API a un GoTrueResult. PURO.
 * - 2xx con id → ok (extrae provider id).
 * - SSO deshabilitado (isSsoDisabledResponse) → sso_disabled (parqueado).
 * - resto → error.
 */
export function classifyGoTrueResult(status: number, body: unknown): GoTrueResult {
  if (status >= 200 && status < 300) {
    const id = body && typeof body === 'object' ? (body as Record<string, unknown>).id : undefined
    return {
      status: 'ok',
      providerId: typeof id === 'string' ? id : undefined,
      message: 'Proveedor SAML registrado/sincronizado en GoTrue.',
    }
  }
  if (isSsoDisabledResponse(status, body)) {
    return {
      status: 'sso_disabled',
      message:
        'SSO no habilitado en el proyecto — configuración persistida; el registro del proveedor queda parqueado (plat:P10).',
    }
  }
  const msg = extractMessage(body)
  return { status: 'error', message: msg || `GoTrue respondió ${status}` }
}
