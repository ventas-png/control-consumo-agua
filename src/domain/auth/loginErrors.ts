// domain/auth/loginErrors.ts — Clasificación PURA de los fallos de login que
// NO son de credenciales (sin red, servidor caído).
//
// POR QUÉ EXISTE
// supabase-js NO lanza cuando la petición de auth no llega a validar nada:
// `handleError` envuelve el fallo en un `AuthRetryableFetchError` y GoTrueClient
// lo DEVUELVE en `{ error }` (`if (isAuthError(e)) return { data, error }`). El
// `catch` de useCredentialsLogin —que sí tenía el mensaje amable de "sin
// conexión"— nunca se ejecutaba para este caso, así que el usuario terminaba
// leyendo el texto CRUDO del motor del navegador:
//
//   Safari/WebKit → "Error: Load failed (<ref>.supabase.co)"
//   Chrome/Edge   → "Error: Failed to fetch"
//   Firefox       → "Error: NetworkError when attempting to fetch resource."
//
// Eso parece un fallo de la aplicación cuando la petición ni siquiera salió del
// teléfono, y no le dice a la persona lo único accionable: revisar su red.
//
// LAS DOS CAUSAS SE SEPARAN A PROPÓSITO
// `AuthRetryableFetchError` cubre dos cosas MUY distintas (ver lib/fetch.ts de
// @supabase/auth-js): status 0 cuando el fetch no obtuvo respuesta —red del
// cliente, DNS, bloqueador, CSP— y status 500-530 cuando el servidor o el edge
// de Cloudflare sí respondieron con un error. Decirle "revise su internet" a
// quien tiene internet perfecto y un backend caído manda a la persona a
// diagnosticar donde no es, así que cada caso lleva su mensaje.

/** La petición no llegó al servidor: red del cliente. */
export const NETWORK_LOGIN_MESSAGE =
  'Sin conexión con el servidor. Revise su internet —pruebe con datos móviles o cambiando de red— e intente de nuevo.'

/** El servidor de auth respondió con un error de infraestructura (5xx). */
export const SERVER_LOGIN_MESSAGE =
  'El servidor de autenticación no está disponible en este momento. No es su contraseña: intente de nuevo en unos minutos.'

/** Forma mínima de un error de auth (AuthError de supabase-js o un Error suelto). */
export interface AuthErrorLike {
  name?: string | null
  message?: string | null
  status?: number | null
}

/**
 * Mensaje de conectividad para un fallo de login, o `null` si el fallo SÍ es una
 * respuesta del servidor sobre las credenciales (contraseña incorrecta, email no
 * confirmado, rate limit…), que el llamador clasifica por su cuenta.
 *
 * Un `null` significa "esto sí lo evaluó el servidor", y de eso depende que el
 * intento cuente para el bloqueo local por intentos fallidos.
 */
export function connectivityLoginMessage(error: AuthErrorLike | null | undefined): string | null {
  if (!error) return null

  const status = typeof error.status === 'number' ? error.status : null
  const retryable = (error.name ?? '') === 'AuthRetryableFetchError'
  const msg = (error.message ?? '').toLowerCase()

  // Mensajes de transporte, uno por motor. Se buscan en el texto porque el
  // status no siempre viaja: un TypeError capturado en el `catch` no lo trae.
  const transportMessage =
    msg.includes('load failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('network error') ||
    msg.includes('fetch')

  if (transportMessage) return NETWORK_LOGIN_MESSAGE
  // status 0 (o ausente) en un retryable = el fetch no obtuvo respuesta.
  if (retryable && (status === null || status === 0)) return NETWORK_LOGIN_MESSAGE
  if (retryable || (status !== null && status >= 500)) return SERVER_LOGIN_MESSAGE

  return null
}
