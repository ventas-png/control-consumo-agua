// domain/auth/mfa.ts — Decisiones PURAS del segundo factor (TOTP). T7/plat:P13.
//
// El I/O (supabase.auth.mfa.*) y el estado React siguen en useAuth; aquí SOLO la
// lógica de DECISIÓN, testeable de forma aislada: detectar el step-up a AAL2,
// seleccionar el factor TOTP verificado, validar el código y clasificar el error
// de verificación. Extraído de useAuth como parte de la modularización P13.

// MFA challenge pendiente tras un sign-in con password cuando el usuario tiene al
// menos un factor TOTP verificado. Señala al login que renderice el input de 6
// dígitos. La sesión NO se guarda hasta que verifyMfaChallenge() tenga éxito —
// Supabase mantiene el token AAL1 en sus tablas auth.*, pero nuestra capa
// UserSession trata AAL1 como "no logueado" a efectos de la app.
export interface MfaChallenge {
  factorId: string
  challengeId: string
  email: string
}

/** Forma mínima de un factor de `listFactors()` (estructural; evita acoplar al tipo de auth-js). */
export interface FactorLike {
  id: string
  factor_type?: string
  status?: string
}

/** Forma mínima de `getAuthenticatorAssuranceLevel()`. */
export interface AalResult {
  error?: unknown
  data?: { currentLevel?: string | null; nextLevel?: string | null } | null
}

/**
 * ¿El usuario debe elevar a AAL2 (segundo factor) AHORA? True sólo si el token
 * actual es `aal1` y el nivel requerido por los factores enrolados es `aal2`.
 */
export function needsTotpStepUp(aal: AalResult): boolean {
  return !aal.error && !!aal.data && aal.data.nextLevel === 'aal2' && aal.data.currentLevel === 'aal1'
}

/**
 * Selecciona el factor TOTP verificado de `listFactors().data`: prefiere `totp[0]`
 * (Supabase ya lo filtra a verificados) y, si no, el primer `all` con
 * `factor_type === 'totp'` y `status === 'verified'`. `null` si no hay ninguno.
 */
export function findVerifiedTotpFactor(
  data: { totp?: FactorLike[]; all?: FactorLike[] } | null | undefined,
): FactorLike | null {
  if (!data) return null
  return data.totp?.[0] ?? data.all?.find(f => f.factor_type === 'totp' && f.status === 'verified') ?? null
}

/** Valida el formato del código TOTP: exactamente 6 dígitos (recorta espacios). */
export function isValidTotpCode(code: string): boolean {
  return /^\d{6}$/.test(code.trim())
}

/** Mapea el error de `mfa.verify()` a un mensaje es-MX para el UI del login. */
export function classifyMfaVerifyError(message: string | null | undefined): string {
  const msg = (message ?? '').toLowerCase()
  if (msg.includes('invalid') || msg.includes('verification') || msg.includes('totp')) {
    return 'Código incorrecto o expirado. Revisa la app de autenticación e intenta de nuevo.'
  }
  return message ? `Error: ${message}` : 'No fue posible verificar el código.'
}
