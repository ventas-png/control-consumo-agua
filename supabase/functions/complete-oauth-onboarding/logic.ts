// Lógica pura de complete-oauth-onboarding, extraída del handler para poder
// testearla en aislamiento (infra:I22 · Track T8/T5). Sin Deno ni supabase-js →
// corre directo en vitest. El handler (index.ts) importa estos símbolos: el
// comportamiento no cambia, solo se mueve la decisión a un archivo importable.

// Error genérico de identidad — el MISMO mensaje para todos los modos de fallo
// (no encontrado, match parcial, cliente ya vinculado) para impedir enumeración.
export const IDENTITY_ERROR = 'No se encontró un cliente con los datos proporcionados. Verifique su DPI/CUI y fecha de nacimiento.'

/**
 * Nombre a mostrar del usuario OAuth: metadata de Google (full_name → name) con
 * fallback al email. Ojo: `??` solo cae en null/undefined — un string vacío en
 * full_name se conserva tal cual (comportamiento del handler, fijado aquí).
 */
export function resolveFullName(
  meta: Record<string, unknown> | null | undefined,
  email: string,
): string {
  return (meta?.full_name as string | undefined) ??
    (meta?.name as string | undefined) ??
    email
}

/** Resultado del RPC buscar_cliente_para_onboarding (SECURITY DEFINER). */
export interface OnboardingLookup {
  match_count: number
  cliente_id: string | null
}

/**
 * `true` solo con match 3-de-3 (email del JWT + DPI + fecha de nacimiento) Y
 * cliente_id presente. Cualquier match parcial se trata como no-encontrado
 * (IDENTITY_ERROR) para no revelar qué campo falló.
 */
export function isIdentityMatch(result: OnboardingLookup): boolean {
  return !(result.match_count < 3 || !result.cliente_id)
}

/**
 * Fila de app_users del nuevo residente OAuth. El rol es SIEMPRE 'cliente' —
 * el onboarding jamás puede producir otro rol (anti escalada de privilegios).
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
