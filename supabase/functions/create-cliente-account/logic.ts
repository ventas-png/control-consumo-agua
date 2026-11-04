// Lógica pura de create-cliente-account, extraída del handler para poder
// testearla en aislamiento (misma convención que complete-oauth-onboarding/
// logic.ts). Sin Deno ni supabase-js → corre directo en vitest. El handler
// (index.ts) importa estos símbolos; la decisión vive aquí.

/**
 * Error genérico de identidad. Es el MISMO mensaje cuando el cliente no existe,
 * cuando algún dato no coincide y cuando el cliente YA tiene cuenta de portal
 * (anti-enumeración: la respuesta no confirma si DPI + fecha + correo
 * identifican a un cliente real). Precisamente por ser único, el texto tiene
 * que cubrir las dos situaciones y decir qué hacer en cada una.
 *
 * Caso real (2026-11-03): un residente entró con Google, completó el
 * onboarding y minutos después administración probó el formulario de registro
 * con sus datos exactos. Cuatro veces «No se encontró un cliente con los datos
 * proporcionados» — con los datos correctos — y un ticket de «la creación de
 * cuentas está fallando». La cuenta existía; el mensaje no lo decía.
 */
export const IDENTITY_ERROR =
  'No se encontró un cliente con los datos proporcionados, o ese cliente ya tiene una cuenta en el portal. ' +
  'Verifique su DPI/CUI, fecha de nacimiento y correo electrónico. ' +
  'Si ya se registró antes o ingresó con Google, vuelva al inicio de sesión y use ' +
  '«Continuar con Google» o «¿Olvidaste tu contraseña?».'

export const DUPLICATE_EMAIL_ERROR = 'El correo electrónico ya está registrado.'
export const GENERIC_CREATE_ERROR = 'No se pudo crear la cuenta. Intente nuevamente.'

/** Resultado del RPC buscar_cliente_para_onboarding (SECURITY DEFINER). */
export interface OnboardingLookup {
  match_count: number
  cliente_id: string | null
}

/**
 * `true` solo con match 3-de-3 (DPI + fecha de nacimiento + correo) Y
 * cliente_id presente. Cualquier match parcial se trata como no-encontrado
 * (IDENTITY_ERROR) para no revelar qué campo falló.
 */
export function isIdentityMatch(result: OnboardingLookup | null | undefined): boolean {
  if (!result) return false
  return !(result.match_count < 3 || !result.cliente_id)
}

/**
 * Forma mínima del error que devuelve `auth.admin.createUser` (AuthError de
 * auth-js; AuthWeakPasswordError añade `reasons`). Tipado estructural para no
 * depender de supabase-js aquí.
 */
export interface AuthCreateErrorLike {
  message?: string | null
  code?: string | null
  name?: string | null
  status?: number | null
  reasons?: string[] | null
}

export type AuthCreateErrorKind = 'duplicate' | 'weak_password' | 'other'

export interface AuthCreateErrorClassification {
  kind: AuthCreateErrorKind
  /** Mensaje para el usuario. Para 'duplicate' el handler puede adoptar un login huérfano antes de usarlo. */
  message: string
}

/**
 * Motivos que Supabase Auth adjunta a `weak_password` (AuthWeakPasswordError.reasons):
 * `pwned` = protección contra contraseñas filtradas (HaveIBeenPwned) activa en
 * el proyecto; `length` / `characters` = política de contraseñas del proyecto.
 */
const WEAK_PASSWORD_REASONS: Record<string, string> = {
  pwned: 'es demasiado común o apareció en filtraciones de datos conocidas',
  length: 'es demasiado corta',
  characters: 'no incluye los tipos de caracteres requeridos',
}

/**
 * Clasifica el error de `auth.admin.createUser` y arma el mensaje al usuario.
 *
 * Antes, todo lo que no fuera «correo duplicado» caía en «No se pudo crear la
 * cuenta. Intente nuevamente.» — incluido el rechazo de Auth por contraseña
 * débil o filtrada (`weak_password`, HTTP 422), que NO es un fallo del
 * sistema y que reintentar con la misma contraseña nunca va a resolver. El
 * primer intento del caso del 2026-11-03 murió exactamente ahí
 * (`reasons: ["pwned"]`) y el residente terminó entrando por Google.
 */
export function classifyAuthCreateError(
  error: AuthCreateErrorLike | null | undefined,
): AuthCreateErrorClassification {
  const message = (error?.message ?? '').toLowerCase()

  if (error?.code === 'weak_password' || error?.name === 'AuthWeakPasswordError') {
    const motivos = (error?.reasons ?? [])
      .map((r) => WEAK_PASSWORD_REASONS[r])
      .filter((m): m is string => Boolean(m))
    const detalle = motivos.length > 0 ? motivos.join(' y ') : 'es demasiado fácil de adivinar'
    return {
      kind: 'weak_password',
      message: `La contraseña ${detalle}. Elija una contraseña distinta, que no use en otros sitios.`,
    }
  }

  if (error?.code === 'email_exists' || message.includes('already')) {
    return { kind: 'duplicate', message: DUPLICATE_EMAIL_ERROR }
  }

  return { kind: 'other', message: GENERIC_CREATE_ERROR }
}
