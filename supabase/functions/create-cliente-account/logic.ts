// Lógica pura de create-cliente-account, extraída del handler para poder
// testearla en aislamiento (infra:I22 · Track T8/T5). Sin Deno ni supabase-js →
// corre directo en vitest. El handler (index.ts) importa estos símbolos: el
// comportamiento no cambia, solo se mueve la decisión a un archivo importable.

// Error genérico de identidad — el MISMO mensaje para "no encontrado" y "ya
// tiene cuenta" para impedir enumeración de clientes desde este endpoint anónimo.
export const IDENTITY_ERROR = 'No se encontró un cliente con los datos proporcionados. Verifique su DPI/CUI, fecha de nacimiento y correo electrónico.'

/** Body del request de alta self-service. */
export interface SignupBody {
  full_name?: string
  email?: string
  cui_dui?: string
  fecha_nacimiento?: string
  password?: string
  legal_accepted?: boolean
}

/** Resultado de la validación de entrada: ok, o el mensaje exacto del handler. */
export type SignupValidation = { ok: true } | { ok: false; error: string }

/**
 * Valida la entrada del alta en el MISMO orden que el handler:
 *   1. Todos los campos requeridos presentes.
 *   2. Click-wrap obligatorio (RGPD/CCPA): legal_accepted debe ser `true`
 *      literal (no truthy — un string 'true' no cuenta).
 *   3. Contraseña de al menos 8 caracteres.
 */
export function validateSignupInput(body: SignupBody): SignupValidation {
  const { full_name, email, cui_dui, fecha_nacimiento, password } = body

  if (!full_name || !email || !cui_dui || !fecha_nacimiento || !password) {
    return { ok: false, error: 'Todos los campos son requeridos.' }
  }
  if (body.legal_accepted !== true) {
    return { ok: false, error: 'Debes aceptar los Términos de Servicio, la Política de Privacidad y el Anexo DPA.' }
  }
  if (password.length < 8) {
    return { ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' }
  }
  return { ok: true }
}

/** Normaliza el email (lowercase + trim), igual que el login. */
export function normalizeEmail(raw: string): string {
  return raw.toLowerCase().trim()
}

/** Resultado del RPC buscar_cliente_para_onboarding (SECURITY DEFINER). */
export interface OnboardingLookup {
  match_count: number
  cliente_id: string | null
}

/**
 * `true` solo con match 3-de-3 (DPI + fecha de nacimiento + email) Y cliente_id
 * presente. Cualquier match parcial se trata como no-encontrado (IDENTITY_ERROR)
 * para no revelar qué campo falló.
 */
export function isIdentityMatch(result: OnboardingLookup): boolean {
  return !(result.match_count < 3 || !result.cliente_id)
}

/**
 * Mensaje del fallo al crear el usuario en Auth: solo se distingue el caso
 * "ya registrado"; el resto colapsa en un genérico (no filtrar detalles).
 */
export function mapAuthCreateError(message: string | undefined): string {
  return message?.includes('already registered')
    ? 'El correo electrónico ya está registrado.'
    : 'No se pudo crear la cuenta. Intente nuevamente.'
}

/**
 * Fila de app_users del nuevo residente. El rol es SIEMPRE 'cliente' — este
 * endpoint anónimo jamás puede producir otro rol (anti escalada de privilegios).
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

/** Documento legal vigente (doc_type + version) leído de legal_documents. */
export interface LegalDoc {
  doc_type: string
  version: string
}

/**
 * Filas de legal_acceptances (evidencia click-wrap): una por documento vigente
 * de usuario, con company_id null (el residente no es tenant), locale 'es' y
 * la IP/user-agent/timestamp capturados server-side.
 */
export function buildLegalAcceptanceRows(
  docs: LegalDoc[],
  ctx: { userId: string; acceptedAt: string; clientIp: string; userAgent: string | null },
): Array<Record<string, unknown>> {
  return docs.map((d) => ({
    user_id: ctx.userId,
    company_id: null,
    doc_type: d.doc_type,
    version: d.version,
    locale: 'es',
    accepted_at: ctx.acceptedAt,
    client_ip: ctx.clientIp,
    user_agent: ctx.userAgent,
  }))
}
